/**
 * AES-256-GCM field-level encryption service.
 *
 * Encrypts sensitive PII fields before they are written to MongoDB,
 * and decrypts them transparently when reading.
 *
 * Encrypted format stored in DB:  ivHex:tagBase64:ciphertextBase64
 * A plain (legacy/unencrypted) field is detected by the absence of ":"
 * and returned as-is (safe migration path).
 *
 * Env: ENCRYPTION_KEY — 64 hex characters (32 bytes)
 * Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import * as crypto from "crypto";

const ALGO = "aes-256-gcm";

@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private key!: Buffer;

  onModuleInit() {
    const hex = process.env.ENCRYPTION_KEY;
    if (!hex || hex.length !== 64) {
      throw new Error(
        "ENCRYPTION_KEY is missing or wrong length (must be 64 hex chars). " +
          "Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    this.key = Buffer.from(hex, "hex");
  }

  encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, this.key, iv);
    let enc = cipher.update(plaintext, "utf8", "base64");
    enc += cipher.final("base64");
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("base64")}:${enc}`;
  }

  decrypt(stored: string): string {
    if (!stored || !stored.includes(":")) return stored; // not encrypted (legacy)
    try {
      const parts = stored.split(":");
      if (parts.length !== 3) return stored;
      const [ivHex, tagB64, ciphertext] = parts;
      const iv = Buffer.from(ivHex, "hex");
      const tag = Buffer.from(tagB64, "base64");
      const decipher = crypto.createDecipheriv(ALGO, this.key, iv);
      decipher.setAuthTag(tag);
      let dec = decipher.update(ciphertext, "base64", "utf8");
      dec += decipher.final("utf8");
      return dec;
    } catch {
      return stored; // corrupted/wrong key → return raw (fallback)
    }
  }

  // Helpers for applying a list of field names to an object
  encryptFields<T extends Record<string, any>>(obj: T, fields: (keyof T)[]): T {
    const copy = { ...obj } as T;
    for (const f of fields) {
      if (copy[f] != null && typeof copy[f] === "string") {
        (copy as any)[f] = this.encrypt(copy[f] as string);
      }
    }
    return copy;
  }

  decryptFields<T extends Record<string, any>>(obj: T, fields: (keyof T)[]): T {
    if (!obj) return obj;
    const copy = { ...obj } as T;
    for (const f of fields) {
      if (copy[f] != null && typeof copy[f] === "string") {
        (copy as any)[f] = this.decrypt(copy[f] as string);
      }
    }
    return copy;
  }

  decryptMany<T extends Record<string, any>>(
    items: T[],
    fields: (keyof T)[],
  ): T[] {
    return items.map((item) => this.decryptFields(item, fields));
  }
}
