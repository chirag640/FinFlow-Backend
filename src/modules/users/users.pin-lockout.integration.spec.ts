import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
import { createHash } from "crypto";
import { AddressInfo } from "net";
import "reflect-metadata";
import { EncryptionService } from "../../common/services/encryption.service";
import { DatabaseService } from "../../database/database.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

const sha256 = (input: string) =>
  createHash("sha256").update(input).digest("hex");

type MutablePinUser = {
  _id: string;
  pinSalt: string | null;
  pinVerifierHash: string | null;
  pinHash: string | null;
  pinFailedAttempts: number;
  pinLockedUntil: Date | null;
  deletedAt: Date | null;
};

describe("Users PIN lockout integration", () => {
  let app: INestApplication;
  let baseUrl: string;
  let userState: MutablePinUser;
  let updateCount = 0;

  beforeEach(async () => {
    const salt = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const candidate = `${salt}:${sha256(`${salt}1234`)}`;
    const verifier = await bcrypt.hash(candidate, 12);

    userState = {
      _id: "u1",
      pinSalt: salt,
      pinVerifierHash: verifier,
      pinHash: null,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      deletedAt: null,
    };
    updateCount = 0;

    const dbMock = {
      users: {
        findOne: async () => ({ ...userState }),
        updateOne: async (
          _filter: Record<string, unknown>,
          update: { $set?: Record<string, unknown> },
        ) => {
          updateCount += 1;
          userState = {
            ...userState,
            ...(update.$set ?? {}),
          } as MutablePinUser;
          return { matchedCount: 1 };
        },
        find: () => ({
          limit: () => ({
            toArray: async () => [],
          }),
        }),
      },
      refreshTokens: {
        deleteMany: async () => ({ deletedCount: 0 }),
      },
      pushDevices: {
        deleteMany: async () => ({ deletedCount: 0 }),
      },
      notificationEvents: {
        deleteMany: async () => ({ deletedCount: 0 }),
      },
    };

    @Module({
      controllers: [UsersController],
      providers: [
        UsersService,
        { provide: DatabaseService, useValue: dbMock },
        {
          provide: EncryptionService,
          useValue: {
            decrypt: (value: string) => value,
            encrypt: (value: string) => value,
          },
        },
      ],
    })
    class UsersPinLockoutIntegrationModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [UsersPinLockoutIntegrationModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req, _res, next) => {
      (req as { user?: { _id: string } }).user = { _id: "u1" };
      next();
    });

    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it("locks after repeated invalid PIN attempts and blocks further checks", async () => {
    for (let i = 0; i < 4; i++) {
      const response = await fetch(`${baseUrl}/users/pin/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: "0000" }),
      });

      expect(response.status).toBe(201);
      const payload = (await response.json()) as {
        valid: boolean;
        remainingAttempts: number;
      };
      expect(payload.valid).toBe(false);
      expect(payload.remainingAttempts).toBeGreaterThan(0);
    }

    const fifth = await fetch(`${baseUrl}/users/pin/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });

    expect(fifth.status).toBe(201);
    const fifthPayload = (await fifth.json()) as {
      valid: boolean;
      remainingAttempts: number;
      lockedUntil: string | null;
    };

    expect(fifthPayload.valid).toBe(false);
    expect(fifthPayload.remainingAttempts).toBe(0);
    expect(typeof fifthPayload.lockedUntil).toBe("string");

    const updatesAfterLock = updateCount;

    const blocked = await fetch(`${baseUrl}/users/pin/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "1234" }),
    });

    expect(blocked.status).toBe(201);
    const blockedPayload = (await blocked.json()) as {
      valid: boolean;
      remainingAttempts: number;
      lockedUntil: string | null;
    };

    expect(blockedPayload.valid).toBe(false);
    expect(blockedPayload.remainingAttempts).toBe(0);
    expect(typeof blockedPayload.lockedUntil).toBe("string");
    expect(updateCount).toBe(updatesAfterLock);
  });
});
