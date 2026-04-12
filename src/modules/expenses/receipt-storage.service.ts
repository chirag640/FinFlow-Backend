import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { promises as fs } from "fs";
import { dirname, extname, isAbsolute, resolve, sep } from "path";
import { AUTH_CONFIG, RECEIPT_CONFIG } from "../../common/constants";

type UploadedReceiptFile = {
  buffer: Buffer;
  size: number;
  mimetype?: string;
};

type UploadIntentResult = {
  uploadUrl: string;
  method: "POST";
  receiptStorageKey: string;
  receiptImageUrl: string;
  expiresAt: string;
  signature: string;
  receiptImageMimeType?: string | null;
};

type UploadResult = {
  receiptStorageKey: string;
  receiptImageUrl: string;
  receiptImageMimeType?: string | null;
};

type ReceiptFileResult =
  | {
      mode: "local";
      absolutePath: string;
      mimeType: string;
    }
  | {
      mode: "redirect";
      redirectUrl: string;
    };

@Injectable()
export class ReceiptStorageService {
  private static readonly STORAGE_KEY_REGEX =
    /^receipts\/[a-zA-Z0-9/_-]+\.[a-z0-9]+$/;

  private readonly storageRoot = this.resolveStorageRoot();
  private readonly uploadSecret = this.resolveUploadSecret();
  private readonly storageProvider = RECEIPT_CONFIG.STORAGE_PROVIDER;
  private readonly s3Bucket = RECEIPT_CONFIG.S3_BUCKET;
  private readonly s3KeyPrefix = this.normalizeS3Prefix(
    RECEIPT_CONFIG.S3_KEY_PREFIX,
  );
  private readonly publicBaseUrl = this.normalizePublicBaseUrl(
    RECEIPT_CONFIG.PUBLIC_BASE_URL,
  );
  private readonly signedReadTtlSeconds = this.resolveSignedReadTtlSeconds();
  private readonly s3Client = this.createS3Client();

  createUploadIntent(
    userId: string,
    mimeType: string | undefined,
    requestOrigin: string,
  ): UploadIntentResult {
    this.assertStorageConfigured();

    const normalizedMimeType = this.normalizeMimeType(mimeType);
    const extension = this.extensionForMimeType(normalizedMimeType);

    const now = Date.now();
    const expiresAtMs = now + RECEIPT_CONFIG.INTENT_TTL_MS;
    const today = new Date(now);
    const year = today.getUTCFullYear();
    const month = String(today.getUTCMonth() + 1).padStart(2, "0");

    const receiptStorageKey =
      `receipts/${year}/${month}/${randomUUID().replace(/-/g, "")}` + extension;
    const signature = this.signIntent(userId, receiptStorageKey, expiresAtMs);

    return {
      uploadUrl: `${this.trimTrailingSlash(requestOrigin)}/api/v1/expenses/receipts/upload`,
      method: "POST",
      receiptStorageKey,
      receiptImageUrl: this.buildProxyReceiptImageUrl(
        requestOrigin,
        receiptStorageKey,
      ),
      expiresAt: new Date(expiresAtMs).toISOString(),
      signature,
      receiptImageMimeType: normalizedMimeType,
    };
  }

  async uploadFromIntent(params: {
    userId: string;
    receiptStorageKey: string;
    expiresAt: string;
    signature: string;
    mimeType?: string;
    file?: UploadedReceiptFile;
    requestOrigin: string;
  }): Promise<UploadResult> {
    const {
      userId,
      receiptStorageKey,
      expiresAt,
      signature,
      mimeType,
      file,
      requestOrigin,
    } = params;

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException("Receipt file is required");
    }

    if (file.size > RECEIPT_CONFIG.MAX_UPLOAD_BYTES) {
      throw new BadRequestException("Receipt image exceeds upload size limit");
    }

    this.assertStorageKey(receiptStorageKey);
    this.assertIntentSignature({
      userId,
      receiptStorageKey,
      expiresAt,
      signature,
    });

    const normalizedMimeType = this.normalizeMimeType(
      mimeType ?? file.mimetype,
    );

    await this.writeReceiptBlob(
      receiptStorageKey,
      file,
      normalizedMimeType ?? file.mimetype ?? null,
    );

    return {
      receiptStorageKey,
      receiptImageUrl: this.buildProxyReceiptImageUrl(
        requestOrigin,
        receiptStorageKey,
      ),
      receiptImageMimeType: normalizedMimeType,
    };
  }

  async getReceiptFile(encodedStorageKey: string): Promise<ReceiptFileResult> {
    const storageKey = this.decodeStorageKey(encodedStorageKey);
    this.assertStorageKey(storageKey);

    if (this.storageProvider === "s3") {
      return {
        mode: "redirect",
        redirectUrl: await this.resolveS3ReadUrl(storageKey),
      };
    }

    const absolutePath = this.resolveStoragePath(storageKey);

    try {
      await fs.access(absolutePath);
    } catch {
      throw new NotFoundException("Receipt file not found");
    }

    return {
      mode: "local",
      absolutePath,
      mimeType: this.mimeTypeFromStorageKey(storageKey),
    };
  }

  private async writeReceiptBlob(
    storageKey: string,
    file: UploadedReceiptFile,
    mimeType: string | null,
  ): Promise<void> {
    this.assertStorageConfigured();

    if (this.storageProvider === "s3") {
      const { client, bucket } = this.requireS3Config();
      const objectKey = this.toS3ObjectKey(storageKey);

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: file.buffer,
          ContentType: mimeType ?? undefined,
        }),
      );
      return;
    }

    const absolutePath = this.resolveStoragePath(storageKey);
    await fs.mkdir(dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.buffer);
  }

  private async resolveS3ReadUrl(storageKey: string): Promise<string> {
    const { client, bucket } = this.requireS3Config();
    const objectKey = this.toS3ObjectKey(storageKey);

    if (!RECEIPT_CONFIG.SIGN_READ_URLS && this.publicBaseUrl) {
      const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
      return `${this.publicBaseUrl}/${encodedKey}`;
    }

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ResponseContentType: this.mimeTypeFromStorageKey(storageKey),
    });

    return getSignedUrl(client, command, {
      expiresIn: this.signedReadTtlSeconds,
    });
  }

  private resolveStorageRoot(): string {
    const configured = RECEIPT_CONFIG.STORAGE_ROOT_DIR;
    return isAbsolute(configured)
      ? configured
      : resolve(process.cwd(), configured);
  }

  private resolveSignedReadTtlSeconds(): number {
    const parsed = Number.parseInt(RECEIPT_CONFIG.SIGNED_READ_TTL_SECONDS, 10);
    if (!Number.isFinite(parsed) || parsed < 60 || parsed > 86_400) {
      return 900;
    }
    return parsed;
  }

  private normalizePublicBaseUrl(value: string): string {
    if (!value) return "";
    return this.trimTrailingSlash(value);
  }

  private normalizeS3Prefix(value: string): string {
    return value.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  }

  private createS3Client(): S3Client | null {
    if (this.storageProvider !== "s3") {
      return null;
    }

    const region = RECEIPT_CONFIG.S3_REGION || "us-east-1";
    const endpoint = RECEIPT_CONFIG.S3_ENDPOINT || undefined;
    const accessKeyId = RECEIPT_CONFIG.S3_ACCESS_KEY_ID;
    const secretAccessKey = RECEIPT_CONFIG.S3_SECRET_ACCESS_KEY;
    const hasExplicitCreds =
      accessKeyId.length > 0 && secretAccessKey.length > 0;

    return new S3Client({
      region,
      endpoint,
      forcePathStyle: RECEIPT_CONFIG.S3_FORCE_PATH_STYLE,
      credentials: hasExplicitCreds
        ? {
            accessKeyId,
            secretAccessKey,
          }
        : undefined,
    });
  }

  private assertStorageConfigured(): void {
    if (this.storageProvider !== "s3") {
      return;
    }
    this.requireS3Config();
  }

  private requireS3Config(): { client: S3Client; bucket: string } {
    if (!this.s3Client || !this.s3Bucket) {
      throw new InternalServerErrorException(
        "Receipt S3 storage is not configured",
      );
    }
    return {
      client: this.s3Client,
      bucket: this.s3Bucket,
    };
  }

  private toS3ObjectKey(storageKey: string): string {
    if (!this.s3KeyPrefix) return storageKey;
    return `${this.s3KeyPrefix}/${storageKey}`;
  }

  private resolveUploadSecret(): string {
    const secret =
      process.env.RECEIPT_UPLOAD_SIGNING_SECRET?.trim() ||
      process.env.JWT_SECRET?.trim();

    if (secret && secret.length > 0) {
      return secret;
    }

    // Development-safe fallback so local environments can run without extra env setup.
    return `finflow-receipt-dev-secret-${AUTH_CONFIG.JWT_EXPIRY_SECONDS}`;
  }

  private trimTrailingSlash(input: string): string {
    return input.replace(/\/+$/, "");
  }

  private signIntent(
    userId: string,
    receiptStorageKey: string,
    expiresAtMs: number,
  ): string {
    const payload = `${userId}:${receiptStorageKey}:${expiresAtMs}`;
    return createHmac("sha256", this.uploadSecret)
      .update(payload)
      .digest("hex");
  }

  private assertIntentSignature(params: {
    userId: string;
    receiptStorageKey: string;
    expiresAt: string;
    signature: string;
  }): void {
    const { userId, receiptStorageKey, expiresAt, signature } = params;
    const expiresAtMs = Date.parse(expiresAt);

    if (!Number.isFinite(expiresAtMs)) {
      throw new BadRequestException("Invalid receipt upload expiry timestamp");
    }

    if (Date.now() > expiresAtMs) {
      throw new BadRequestException("Receipt upload intent has expired");
    }

    if (!/^[a-fA-F0-9]{64}$/.test(signature)) {
      throw new BadRequestException("Invalid receipt upload signature");
    }

    const expectedSignature = this.signIntent(
      userId,
      receiptStorageKey,
      expiresAtMs,
    );
    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const providedBuffer = Buffer.from(signature, "hex");

    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new BadRequestException("Receipt upload signature mismatch");
    }
  }

  private assertStorageKey(storageKey: string): void {
    if (!storageKey || storageKey.length > 256) {
      throw new BadRequestException("Invalid receipt storage key");
    }

    if (
      storageKey.includes("..") ||
      storageKey.startsWith("/") ||
      storageKey.startsWith("\\")
    ) {
      throw new BadRequestException("Invalid receipt storage key path");
    }

    if (!ReceiptStorageService.STORAGE_KEY_REGEX.test(storageKey)) {
      throw new BadRequestException("Unsupported receipt storage key format");
    }
  }

  private resolveStoragePath(storageKey: string): string {
    const absolutePath = resolve(this.storageRoot, storageKey);
    const normalizedRoot = resolve(this.storageRoot);

    if (
      absolutePath !== normalizedRoot &&
      !absolutePath.startsWith(`${normalizedRoot}${sep}`)
    ) {
      throw new BadRequestException("Invalid receipt storage path");
    }

    return absolutePath;
  }

  private buildProxyReceiptImageUrl(
    requestOrigin: string,
    storageKey: string,
  ): string {
    const encodedStorageKey = this.encodeStorageKey(storageKey);
    return `${this.trimTrailingSlash(requestOrigin)}/api/v1/expenses/receipts/file/${encodedStorageKey}`;
  }

  private encodeStorageKey(storageKey: string): string {
    return Buffer.from(storageKey, "utf8").toString("base64url");
  }

  private decodeStorageKey(encodedStorageKey: string): string {
    try {
      const decoded = Buffer.from(encodedStorageKey, "base64url").toString(
        "utf8",
      );
      if (!decoded) {
        throw new Error("Decoded key is empty");
      }
      return decoded;
    } catch {
      throw new NotFoundException("Receipt file not found");
    }
  }

  private normalizeMimeType(input?: string): string | null {
    if (!input) return null;
    const normalized = input.trim().toLowerCase();
    if (
      (RECEIPT_CONFIG.ALLOWED_MIME_TYPES as readonly string[]).includes(
        normalized,
      )
    ) {
      return normalized;
    }
    throw new BadRequestException("Unsupported receipt image type");
  }

  private extensionForMimeType(mimeType: string | null): string {
    switch (mimeType) {
      case "image/png":
        return ".png";
      case "image/webp":
        return ".webp";
      case "image/heic":
        return ".heic";
      case "image/jpeg":
      default:
        return ".jpg";
    }
  }

  private mimeTypeFromStorageKey(storageKey: string): string {
    switch (extname(storageKey).toLowerCase()) {
      case ".png":
        return "image/png";
      case ".webp":
        return "image/webp";
      case ".heic":
        return "image/heic";
      case ".jpg":
      case ".jpeg":
      default:
        return "image/jpeg";
    }
  }
}
