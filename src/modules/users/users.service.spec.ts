import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as bcrypt from "bcrypt";
import { createHash } from "crypto";
import { UsersService } from "./users.service";

const sha256 = (input: string) =>
  createHash("sha256").update(input).digest("hex");

describe("UsersService PIN security", () => {
  let service: UsersService;
  let db: any;
  let encryption: any;

  beforeEach(() => {
    db = {
      users: {
        findOne: jest.fn(),
        updateOne: jest.fn(async () => ({ matchedCount: 1 })),
      },
      refreshTokens: {
        deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
      },
      pushDevices: {
        deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
      },
      notificationEvents: {
        deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
      },
    };

    encryption = {
      decrypt: jest.fn((v: string) => v),
      encrypt: jest.fn((v: string) => v),
    };

    service = new UsersService(db, encryption);
  });

  it("persists bcrypt PIN verifier on updatePin", async () => {
    const salt = "0123456789abcdef0123456789abcdef";
    const digest = sha256(`${salt}1234`);
    const pinHash = `${salt}:${digest}`;

    await service.updatePin("u1", pinHash);

    expect(db.users.updateOne).toHaveBeenCalledTimes(1);
    const update = db.users.updateOne.mock.calls[0][1].$set;
    expect(update.pinHash).toBeNull();
    expect(update.pinSalt).toBe(salt);
    expect(typeof update.pinVerifierHash).toBe("string");
    expect(update.pinVerifierHash.startsWith("$2")).toBe(true);
  });

  it("rejects undefined pinHash payload", async () => {
    await expect(
      service.updatePin("u1", undefined as unknown as string | null),
    ).rejects.toThrow("pinHash is required");
  });

  it("verifies PIN against bcrypt verifier and resets lock counters", async () => {
    const salt = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const candidate = `${salt}:${sha256(`${salt}1234`)}`;
    const verifier = await bcrypt.hash(candidate, 12);

    db.users.findOne.mockResolvedValue({
      _id: "u1",
      pinSalt: salt,
      pinVerifierHash: verifier,
      pinHash: null,
      pinFailedAttempts: 2,
      pinLockedUntil: null,
      deletedAt: null,
    });

    const result = await service.verifyPin("u1", "1234");

    expect(result.valid).toBe(true);
    expect(db.users.updateOne).toHaveBeenCalledWith(
      { _id: "u1" },
      {
        $set: expect.objectContaining({
          pinFailedAttempts: 0,
          pinLockedUntil: null,
          pinLastFailedAt: null,
        }),
      },
    );
  });

  it("trims whitespace around submitted PIN before verification", async () => {
    const salt = "dddddddddddddddddddddddddddddddd";
    const candidate = `${salt}:${sha256(`${salt}1234`)}`;
    const verifier = await bcrypt.hash(candidate, 12);

    db.users.findOne.mockResolvedValue({
      _id: "u1",
      pinSalt: salt,
      pinVerifierHash: verifier,
      pinHash: null,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      deletedAt: null,
    });

    const result = await service.verifyPin("u1", " 1234 ");
    expect(result.valid).toBe(true);
  });

  it("migrates legacy pinHash to bcrypt verifier on successful verify", async () => {
    const salt = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const legacyHash = `${salt}:${sha256(`${salt}2468`)}`;

    db.users.findOne.mockResolvedValue({
      _id: "u1",
      pinSalt: null,
      pinVerifierHash: null,
      pinHash: legacyHash,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      deletedAt: null,
    });

    const result = await service.verifyPin("u1", "2468");

    expect(result.valid).toBe(true);
    const migratedSet = db.users.updateOne.mock.calls[0][1].$set;
    expect(migratedSet.pinHash).toBeNull();
    expect(migratedSet.pinSalt).toBe(salt);
    expect(typeof migratedSet.pinVerifierHash).toBe("string");
    expect(migratedSet.pinVerifierHash.startsWith("$2")).toBe(true);
  });

  it("locks PIN verification after repeated failures", async () => {
    const salt = "cccccccccccccccccccccccccccccccc";
    const candidate = `${salt}:${sha256(`${salt}1111`)}`;
    const verifier = await bcrypt.hash(candidate, 12);

    db.users.findOne.mockResolvedValue({
      _id: "u1",
      pinSalt: salt,
      pinVerifierHash: verifier,
      pinHash: null,
      pinFailedAttempts: 4,
      pinLockedUntil: null,
      deletedAt: null,
    });

    const result = await service.verifyPin("u1", "9999");

    expect(result.valid).toBe(false);
    expect(result.remainingAttempts).toBe(0);
    expect(typeof result.lockedUntil).toBe("string");

    const set = db.users.updateOne.mock.calls[0][1].$set;
    expect(set.pinFailedAttempts).toBe(5);
    expect(set.pinLockedUntil).toBeInstanceOf(Date);
  });

  it("returns locked response immediately when lock window is active", async () => {
    const futureLock = new Date(Date.now() + 45_000);

    db.users.findOne.mockResolvedValue({
      _id: "u1",
      pinSalt: null,
      pinVerifierHash: null,
      pinHash: null,
      pinFailedAttempts: 5,
      pinLockedUntil: futureLock,
      deletedAt: null,
    });

    const result = await service.verifyPin("u1", "1234");

    expect(result.valid).toBe(false);
    expect(result.remainingAttempts).toBe(0);
    expect(result.lockedUntil).toBe(futureLock.toISOString());
    expect(db.users.updateOne).not.toHaveBeenCalled();
  });
});
