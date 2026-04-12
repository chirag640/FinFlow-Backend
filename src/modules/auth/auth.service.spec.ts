import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { createHash } from "crypto";
import { AuthService } from "./auth.service";

describe("AuthService.refresh", () => {
  let service: AuthService;
  let db: any;
  let jwtService: any;
  let encryption: any;

  beforeEach(() => {
    db = {
      users: {
        findOne: jest.fn(),
      },
      refreshTokens: {
        findOne: jest.fn(),
        deleteOne: jest.fn(),
        deleteMany: jest.fn(),
        insertOne: jest.fn(),
      },
    };

    jwtService = {
      sign: jest.fn((payload: Record<string, unknown>) =>
        payload.sub ? "rt-new" : "at-new",
      ),
      verify: jest.fn(() => ({ sub: "u1" })),
    };

    encryption = {
      decrypt: jest.fn((v: string) => v),
    };

    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    process.env.JWT_REFRESH_SECRET_PREVIOUS = "";
    process.env.JWT_REFRESH_EXPIRES_IN = "7d";

    service = new AuthService(db, jwtService, encryption);
  });

  it("rejects expired refresh token and removes stale session", async () => {
    db.refreshTokens.findOne.mockResolvedValue({
      _id: "session-1",
      token: "rt-old",
      userId: "u1",
      expiresAt: new Date(Date.now() - 1000),
    });
    db.refreshTokens.deleteOne.mockResolvedValue({ deletedCount: 1 });

    await expect(service.refresh("rt-old")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.refreshTokens.deleteOne).toHaveBeenCalledWith({
      _id: "session-1",
    });
  });

  it("handles refresh race: second call with rotated token fails safely", async () => {
    db.refreshTokens.findOne
      .mockResolvedValueOnce({
        _id: "session-1",
        token: "rt-old",
        userId: "u1",
        expiresAt: new Date(Date.now() + 60_000),
        userAgent: "flutter",
      })
      .mockResolvedValueOnce(null);

    db.users.findOne.mockResolvedValue({
      _id: "u1",
      email: "user@example.com",
      username: "demo",
      name: "Demo User",
      role: "USER",
      currency: "INR",
      emailVerified: true,
      monthlyBudget: 0,
      deletedAt: null,
    });

    db.refreshTokens.deleteOne.mockResolvedValue({ deletedCount: 1 });
    db.refreshTokens.insertOne.mockResolvedValue({ acknowledged: true });

    const first = await service.refresh("rt-old", {
      userAgent: "flutter",
      ipAddress: "10.0.2.2",
      deviceName: "Flutter Android App",
    });

    expect(first.refreshToken).toBe("rt-new");
    expect(db.refreshTokens.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        token: createHash("sha256").update("rt-new").digest("hex"),
      }),
    );

    await expect(service.refresh("rt-old")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("keeps stored device name during refresh when x-device-name is missing", async () => {
    db.refreshTokens.findOne.mockResolvedValue({
      _id: "session-2",
      token: "rt-old",
      userId: "u1",
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: "Dart/3.11 (dart:io)",
      deviceName: "Samsung SM-A55",
      ipAddress: "10.0.2.2",
    });

    db.users.findOne.mockResolvedValue({
      _id: "u1",
      email: "user@example.com",
      username: "demo",
      name: "Demo User",
      role: "USER",
      currency: "INR",
      emailVerified: true,
      monthlyBudget: 0,
      deletedAt: null,
    });

    db.refreshTokens.deleteOne.mockResolvedValue({ deletedCount: 1 });
    db.refreshTokens.insertOne.mockResolvedValue({ acknowledged: true });

    await service.refresh("rt-old", {
      userAgent: "Dart/3.11 (dart:io)",
      ipAddress: "10.0.2.2",
    });

    expect(db.refreshTokens.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "session-2",
        deviceName: "Samsung SM-A55",
      }),
    );
  });

  it("accepts refresh token signed with previous secret during rotation", async () => {
    process.env.JWT_REFRESH_SECRET_PREVIOUS = "legacy-refresh-secret";
    jwtService.verify.mockImplementation(
      (_token: string, options: { secret: string }) => {
        if (options.secret === "test-refresh-secret") {
          throw new Error("invalid signature");
        }
        return { sub: "u1" };
      },
    );

    db.refreshTokens.findOne.mockResolvedValue({
      _id: "session-legacy",
      token: "rt-old",
      userId: "u1",
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: "flutter",
    });

    db.users.findOne.mockResolvedValue({
      _id: "u1",
      email: "user@example.com",
      username: "demo",
      name: "Demo User",
      role: "USER",
      currency: "INR",
      emailVerified: true,
      monthlyBudget: 0,
      deletedAt: null,
    });

    db.refreshTokens.deleteOne.mockResolvedValue({ deletedCount: 1 });
    db.refreshTokens.insertOne.mockResolvedValue({ acknowledged: true });

    const refreshed = await service.refresh("rt-old");

    expect(refreshed.refreshToken).toBe("rt-new");
    expect(jwtService.verify).toHaveBeenCalledWith(
      "rt-old",
      expect.objectContaining({
        secret: "legacy-refresh-secret",
        ignoreExpiration: true,
      }),
    );
  });

  it("rejects refresh token with invalid signature before DB lookup", async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    await expect(service.refresh("rt-invalid")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.refreshTokens.findOne).not.toHaveBeenCalled();
  });
});

describe("AuthService.logout", () => {
  let service: AuthService;
  let db: any;
  let jwtService: any;
  let encryption: any;

  beforeEach(() => {
    db = {
      users: {
        findOne: jest.fn(),
      },
      refreshTokens: {
        findOne: jest.fn(),
        deleteOne: jest.fn(),
        deleteMany: jest.fn(),
        insertOne: jest.fn(),
      },
    };

    jwtService = {
      sign: jest.fn(),
    };

    encryption = {
      decrypt: jest.fn((v: string) => v),
    };

    service = new AuthService(db, jwtService, encryption);
  });

  it("deletes refresh token sessions by token", async () => {
    await service.logout("rt-logout");

    expect(db.refreshTokens.deleteMany).toHaveBeenCalledWith({
      token: {
        $in: [
          createHash("sha256").update("rt-logout").digest("hex"),
          "rt-logout",
        ],
      },
    });
  });
});

describe("AuthService email normalization", () => {
  let service: AuthService;
  let db: any;
  let jwtService: any;
  let encryption: any;

  beforeEach(() => {
    db = {
      users: {
        findOne: jest.fn(),
        updateOne: jest.fn(),
      },
      refreshTokens: {
        findOne: jest.fn(),
        deleteOne: jest.fn(),
        deleteMany: jest.fn(),
        insertOne: jest.fn(),
      },
    };

    jwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
    };

    encryption = {
      decrypt: jest.fn((v: string) => v),
    };

    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

    service = new AuthService(db, jwtService, encryption);
  });

  it("normalizes email for login lookup", async () => {
    db.users.findOne.mockResolvedValue(null);

    await expect(
      service.login({ email: "  USER@Example.COM ", password: "password123" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(db.users.findOne).toHaveBeenCalledWith({
      email: "user@example.com",
      deletedAt: null,
    });
  });

  it("normalizes email for forgot-password lookup", async () => {
    db.users.findOne.mockResolvedValue(null);

    await expect(
      service.forgotPassword("  USER@Example.COM "),
    ).resolves.toBeUndefined();

    expect(db.users.findOne).toHaveBeenCalledWith({
      email: "user@example.com",
      deletedAt: null,
    });
  });

  it("normalizes email for reset-password lookup", async () => {
    db.users.findOne.mockResolvedValue(null);

    await expect(
      service.resetPassword("  USER@Example.COM ", "123456", "NewPass123"),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.users.findOne).toHaveBeenCalledWith({
      email: "user@example.com",
      deletedAt: null,
    });
  });
});
