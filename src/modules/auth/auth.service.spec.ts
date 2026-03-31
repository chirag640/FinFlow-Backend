import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { UnauthorizedException } from "@nestjs/common";
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
        insertOne: jest.fn(),
      },
    };

    jwtService = {
      sign: jest.fn((payload: Record<string, unknown>) =>
        payload.sub ? "rt-new" : "at-new",
      ),
    };

    encryption = {
      decrypt: jest.fn((v: string) => v),
    };

    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
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

    await expect(service.refresh("rt-old")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
