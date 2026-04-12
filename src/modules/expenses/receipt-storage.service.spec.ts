import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { access, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const sendMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const getSignedUrlMock = jest.fn<(...args: unknown[]) => Promise<string>>();

jest.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    config: unknown;

    constructor(config: unknown) {
      this.config = config;
    }

    send = sendMock;
  }

  class MockPutObjectCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  class MockGetObjectCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockPutObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
  };
});

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

const RECEIPT_ENV_KEYS = [
  "RECEIPT_STORAGE_PROVIDER",
  "RECEIPT_STORAGE_DIR",
  "RECEIPT_SIGN_READ_URLS",
  "RECEIPT_SIGNED_READ_TTL_SECONDS",
  "RECEIPT_PUBLIC_BASE_URL",
  "RECEIPT_S3_BUCKET",
  "RECEIPT_S3_REGION",
  "RECEIPT_S3_ENDPOINT",
  "RECEIPT_S3_ACCESS_KEY_ID",
  "RECEIPT_S3_SECRET_ACCESS_KEY",
  "RECEIPT_S3_KEY_PREFIX",
  "RECEIPT_S3_FORCE_PATH_STYLE",
  "RECEIPT_UPLOAD_SIGNING_SECRET",
];

const originalEnv = { ...process.env };

function resetReceiptEnv() {
  for (const key of RECEIPT_ENV_KEYS) {
    delete process.env[key];
  }
}

async function createService() {
  jest.resetModules();
  const module = await import("./receipt-storage.service");
  return new module.ReceiptStorageService();
}

describe("ReceiptStorageService", () => {
  beforeEach(() => {
    resetReceiptEnv();
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
    getSignedUrlMock.mockReset();
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("stores and reads uploaded receipts in local mode", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "finflow-receipt-local-"));
    process.env.RECEIPT_STORAGE_PROVIDER = "local";
    process.env.RECEIPT_STORAGE_DIR = tempRoot;

    const service = await createService();
    const intent = service.createUploadIntent(
      "user-local",
      "image/png",
      "http://localhost:3000",
    );

    const uploadResult = await service.uploadFromIntent({
      userId: "user-local",
      receiptStorageKey: intent.receiptStorageKey,
      expiresAt: intent.expiresAt,
      signature: intent.signature,
      mimeType: "image/png",
      requestOrigin: "http://localhost:3000",
      file: {
        buffer: Buffer.from("local-receipt-content"),
        size: Buffer.byteLength("local-receipt-content"),
        mimetype: "image/png",
      },
    });

    const encodedStorageKey = Buffer.from(
      uploadResult.receiptStorageKey,
      "utf8",
    ).toString("base64url");

    const fileResult = await service.getReceiptFile(encodedStorageKey);
    expect(fileResult.mode).toBe("local");
    if (fileResult.mode === "local") {
      await expect(access(fileResult.absolutePath)).resolves.toBeUndefined();
      expect(fileResult.mimeType).toBe("image/png");
    }

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns signed redirect urls for S3 mode when signed reads are enabled", async () => {
    process.env.RECEIPT_STORAGE_PROVIDER = "s3";
    process.env.RECEIPT_S3_BUCKET = "receipt-bucket";
    process.env.RECEIPT_S3_REGION = "us-east-1";
    process.env.RECEIPT_S3_KEY_PREFIX = "finflow";
    process.env.RECEIPT_SIGN_READ_URLS = "true";

    getSignedUrlMock.mockResolvedValue("https://signed.example.com/receipt");

    const service = await createService();
    const intent = service.createUploadIntent(
      "user-s3",
      "image/jpeg",
      "http://localhost:3000",
    );

    await service.uploadFromIntent({
      userId: "user-s3",
      receiptStorageKey: intent.receiptStorageKey,
      expiresAt: intent.expiresAt,
      signature: intent.signature,
      mimeType: "image/jpeg",
      requestOrigin: "http://localhost:3000",
      file: {
        buffer: Buffer.from("s3-receipt-content"),
        size: Buffer.byteLength("s3-receipt-content"),
        mimetype: "image/jpeg",
      },
    });

    const encodedStorageKey = Buffer.from(
      intent.receiptStorageKey,
      "utf8",
    ).toString("base64url");

    const fileResult = await service.getReceiptFile(encodedStorageKey);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(fileResult.mode).toBe("redirect");
    if (fileResult.mode === "redirect") {
      expect(fileResult.redirectUrl).toBe("https://signed.example.com/receipt");
    }
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
  });

  it("returns public redirect urls for S3 mode when signed reads are disabled", async () => {
    process.env.RECEIPT_STORAGE_PROVIDER = "s3";
    process.env.RECEIPT_S3_BUCKET = "receipt-bucket";
    process.env.RECEIPT_S3_REGION = "us-east-1";
    process.env.RECEIPT_S3_KEY_PREFIX = "finflow";
    process.env.RECEIPT_SIGN_READ_URLS = "false";
    process.env.RECEIPT_PUBLIC_BASE_URL = "https://cdn.example.com/";

    const service = await createService();
    const intent = service.createUploadIntent(
      "user-public",
      "image/webp",
      "http://localhost:3000",
    );

    await service.uploadFromIntent({
      userId: "user-public",
      receiptStorageKey: intent.receiptStorageKey,
      expiresAt: intent.expiresAt,
      signature: intent.signature,
      mimeType: "image/webp",
      requestOrigin: "http://localhost:3000",
      file: {
        buffer: Buffer.from("s3-public-receipt-content"),
        size: Buffer.byteLength("s3-public-receipt-content"),
        mimetype: "image/webp",
      },
    });

    const encodedStorageKey = Buffer.from(
      intent.receiptStorageKey,
      "utf8",
    ).toString("base64url");

    const fileResult = await service.getReceiptFile(encodedStorageKey);
    expect(fileResult.mode).toBe("redirect");
    if (fileResult.mode === "redirect") {
      expect(fileResult.redirectUrl).toContain(
        "https://cdn.example.com/finflow/",
      );
      expect(fileResult.redirectUrl).toContain("/receipts/");
    }
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });
});
