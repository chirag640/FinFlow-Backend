import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
import { AddressInfo } from "net";
import "reflect-metadata";
import { EncryptionService } from "../../common/services/encryption.service";
import { DatabaseService } from "../../database/database.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

type MutableUser = {
  _id: string;
  email: string;
  username: string;
  name: string;
  passwordHash: string;
  role: "USER" | "ADMIN";
  currency: string;
  monthlyBudget: number;
  emailVerified: boolean;
  pinHash: string | null;
  pinSalt: string | null;
  pinVerifierHash: string | null;
  pinFailedAttempts: number;
  pinLockedUntil: Date | null;
  pinLastFailedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

describe("Users delete-account integration", () => {
  let app: INestApplication;
  let baseUrl: string;
  let userState: MutableUser;
  let refreshPurgeCalls = 0;
  let pushDevicePurgeCalls = 0;
  let notificationPurgeCalls = 0;

  beforeEach(async () => {
    const passwordHash = await bcrypt.hash("Secret123", 12);
    const now = new Date();

    userState = {
      _id: "u1",
      email: "user@example.com",
      username: "demo_user",
      name: "Encrypted Name",
      passwordHash,
      role: "USER",
      currency: "INR",
      monthlyBudget: 0,
      emailVerified: true,
      pinHash: null,
      pinSalt: null,
      pinVerifierHash: null,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      pinLastFailedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    refreshPurgeCalls = 0;
    pushDevicePurgeCalls = 0;
    notificationPurgeCalls = 0;

    const dbMock = {
      users: {
        findOne: async (query: { _id: string; deletedAt?: null }) => {
          if (query._id !== userState._id) return null;
          if (query.deletedAt === null && userState.deletedAt !== null) {
            return null;
          }
          return { ...userState };
        },
        updateOne: async (
          filter: { _id: string; deletedAt?: null },
          update: { $set?: Record<string, unknown> },
        ) => {
          if (filter._id !== userState._id) return { matchedCount: 0 };
          if (filter.deletedAt === null && userState.deletedAt !== null) {
            return { matchedCount: 0 };
          }
          userState = {
            ...userState,
            ...(update.$set ?? {}),
          } as MutableUser;
          return { matchedCount: 1 };
        },
        find: () => ({
          limit: () => ({
            toArray: async () => [],
          }),
        }),
      },
      refreshTokens: {
        deleteMany: async (_query: { userId: string }) => {
          refreshPurgeCalls += 1;
          return { deletedCount: 2 };
        },
      },
      pushDevices: {
        deleteMany: async (_query: { userId: string }) => {
          pushDevicePurgeCalls += 1;
          return { deletedCount: 1 };
        },
      },
      notificationEvents: {
        deleteMany: async (_query: { userId: string }) => {
          notificationPurgeCalls += 1;
          return { deletedCount: 3 };
        },
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
    class UsersDeleteAccountIntegrationTestModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [UsersDeleteAccountIntegrationTestModule],
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

  it("returns 400 when current password is incorrect", async () => {
    const response = await fetch(`${baseUrl}/users/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "WrongPass9" }),
    });

    expect(response.status).toBe(400);
    expect(userState.deletedAt).toBeNull();
    expect(refreshPurgeCalls).toBe(0);
    expect(pushDevicePurgeCalls).toBe(0);
    expect(notificationPurgeCalls).toBe(0);
  });

  it("soft-deletes account and purges session/device/event records", async () => {
    const response = await fetch(`${baseUrl}/users/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "Secret123" }),
    });

    expect(response.status).toBe(204);
    expect(userState.deletedAt).toBeInstanceOf(Date);
    expect(userState.email.startsWith("deleted+u1")).toBe(true);
    expect(userState.username.startsWith("deleted_u1")).toBe(true);
    expect(refreshPurgeCalls).toBe(1);
    expect(pushDevicePurgeCalls).toBe(1);
    expect(notificationPurgeCalls).toBe(1);
  });

  it("returns 404 when deleting an already deleted account", async () => {
    const firstDelete = await fetch(`${baseUrl}/users/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "Secret123" }),
    });
    expect(firstDelete.status).toBe(204);

    const secondDelete = await fetch(`${baseUrl}/users/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "Secret123" }),
    });

    expect(secondDelete.status).toBe(404);
    expect(refreshPurgeCalls).toBe(1);
    expect(pushDevicePurgeCalls).toBe(1);
    expect(notificationPurgeCalls).toBe(1);
  });
});
