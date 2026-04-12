#!/usr/bin/env node

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { MongoClient } from "mongodb";
import { dirname, isAbsolute, resolve } from "path";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

function boolArg(name) {
  return process.argv.includes(name);
}

function intArg(name, fallback) {
  const arg = process.argv.find((value) => value.startsWith(`${name}=`));
  if (!arg) return fallback;
  const parsed = Number.parseInt(arg.slice(name.length + 1), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveStorageRoot(storageDir) {
  if (isAbsolute(storageDir)) return storageDir;
  return resolve(process.cwd(), storageDir);
}

function parseDatabaseName(databaseUrl) {
  return databaseUrl.split("/").pop()?.split("?")[0] || "finflow_db";
}

function normalizeMimeType(input) {
  if (!input) return "image/jpeg";
  const normalized = input.trim().toLowerCase();
  if (ALLOWED_MIME_TYPES.has(normalized)) return normalized;
  return "image/jpeg";
}

function extensionForMimeType(mimeType) {
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

function buildStorageKey(date, mimeType) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `receipts/${year}/${month}/${randomUUID().replace(/-/g, "")}${extensionForMimeType(mimeType)}`;
}

function decodeEmbeddedReceipt(inputValue, fallbackMimeType) {
  const raw = (inputValue || "").trim();
  if (!raw) {
    throw new Error("embedded receipt payload is empty");
  }

  const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/i);
  const mimeType = normalizeMimeType(dataUrlMatch?.[1] || fallbackMimeType);
  const base64Payload = dataUrlMatch?.[2] || raw;

  const buffer = Buffer.from(base64Payload, "base64");
  if (buffer.length === 0) {
    throw new Error("decoded embedded receipt payload is empty");
  }

  return {
    buffer,
    mimeType,
  };
}

function normalizePrefix(prefix) {
  return (prefix || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function toObjectKey(prefix, storageKey) {
  if (!prefix) return storageKey;
  return `${prefix}/${storageKey}`;
}

async function main() {
  const dryRun = boolArg("--dry-run");
  const batchSize = intArg("--batch-size", 100);
  const maxBatches = intArg("--max-batches", Number.MAX_SAFE_INTEGER);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const provider = (process.env.RECEIPT_STORAGE_PROVIDER || "local")
    .trim()
    .toLowerCase();

  const storageDir = process.env.RECEIPT_STORAGE_DIR || "storage";
  const storageRoot = resolveStorageRoot(storageDir);

  const s3Bucket = (process.env.RECEIPT_S3_BUCKET || "").trim();
  const s3Region = (process.env.RECEIPT_S3_REGION || "us-east-1").trim();
  const s3Endpoint = (process.env.RECEIPT_S3_ENDPOINT || "").trim();
  const s3AccessKeyId = (process.env.RECEIPT_S3_ACCESS_KEY_ID || "").trim();
  const s3SecretAccessKey = (
    process.env.RECEIPT_S3_SECRET_ACCESS_KEY || ""
  ).trim();
  const s3KeyPrefix = normalizePrefix(
    process.env.RECEIPT_S3_KEY_PREFIX || "receipts",
  );
  const s3ForcePathStyle =
    (process.env.RECEIPT_S3_FORCE_PATH_STYLE || "false")
      .trim()
      .toLowerCase() === "true";

  let s3Client = null;
  if (provider === "s3") {
    if (!s3Bucket) {
      throw new Error(
        "RECEIPT_S3_BUCKET is required when RECEIPT_STORAGE_PROVIDER=s3",
      );
    }

    const hasExplicitCredentials =
      s3AccessKeyId.length > 0 && s3SecretAccessKey.length > 0;

    s3Client = new S3Client({
      region: s3Region,
      endpoint: s3Endpoint || undefined,
      forcePathStyle: s3ForcePathStyle,
      credentials: hasExplicitCredentials
        ? {
            accessKeyId: s3AccessKeyId,
            secretAccessKey: s3SecretAccessKey,
          }
        : undefined,
    });
  }

  const client = new MongoClient(databaseUrl);
  await client.connect();
  const dbName = parseDatabaseName(databaseUrl);
  const db = client.db(dbName);
  const expenses = db.collection("Expense");

  let migratedCount = 0;
  let failedCount = 0;
  let scannedCount = 0;
  let batchCount = 0;

  console.log(
    `[migrate:receipts] Starting migration (provider=${provider}, dryRun=${dryRun}, batchSize=${batchSize})`,
  );

  try {
    while (batchCount < maxBatches) {
      const docs = await expenses
        .find(
          {
            receiptImageBase64: { $type: "string", $ne: "" },
            $or: [
              { receiptStorageKey: { $exists: false } },
              { receiptStorageKey: null },
              { receiptStorageKey: "" },
            ],
          },
          {
            projection: {
              _id: 1,
              receiptImageBase64: 1,
              receiptImageMimeType: 1,
            },
          },
        )
        .limit(batchSize)
        .toArray();

      if (docs.length === 0) {
        break;
      }

      batchCount += 1;
      console.log(
        `[migrate:receipts] Processing batch ${batchCount} with ${docs.length} document(s)`,
      );

      for (const doc of docs) {
        scannedCount += 1;
        try {
          const { buffer, mimeType } = decodeEmbeddedReceipt(
            doc.receiptImageBase64,
            doc.receiptImageMimeType,
          );
          const storageKey = buildStorageKey(new Date(), mimeType);

          if (!dryRun) {
            if (provider === "s3") {
              const objectKey = toObjectKey(s3KeyPrefix, storageKey);
              await s3Client.send(
                new PutObjectCommand({
                  Bucket: s3Bucket,
                  Key: objectKey,
                  Body: buffer,
                  ContentType: mimeType,
                }),
              );
            } else {
              const absolutePath = resolve(storageRoot, storageKey);
              await mkdir(dirname(absolutePath), { recursive: true });
              await writeFile(absolutePath, buffer);
            }

            await expenses.updateOne(
              { _id: doc._id },
              {
                $set: {
                  receiptStorageKey: storageKey,
                  receiptImageMimeType: mimeType,
                  receiptImageUrl: null,
                  updatedAt: new Date(),
                },
                $unset: {
                  receiptImageBase64: "",
                },
              },
            );
          }

          migratedCount += 1;
        } catch (error) {
          failedCount += 1;
          console.error(
            `[migrate:receipts] Failed to migrate expense ${String(doc._id)}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    console.log(
      `[migrate:receipts] Completed. scanned=${scannedCount} migrated=${migratedCount} failed=${failedCount} dryRun=${dryRun}`,
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(
    `[migrate:receipts] Fatal error: ${error instanceof Error ? error.stack || error.message : String(error)}`,
  );
  process.exitCode = 1;
});
