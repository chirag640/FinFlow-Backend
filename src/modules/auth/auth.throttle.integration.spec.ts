import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { INestApplication, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AddressInfo } from "net";
import "reflect-metadata";
import { EncryptionService } from "../../common/services/encryption.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

const authServiceMock = {
  register: async () => ({ userId: "u1" }),
  login: async () => ({ accessToken: "a", refreshToken: "r" }),
  verifyEmail: async () => ({ accessToken: "a", refreshToken: "r" }),
  resendOtp: async () => undefined,
  forgotPassword: async () => undefined,
  resetPassword: async () => undefined,
  refresh: async () => ({ accessToken: "a", refreshToken: "r" }),
  logout: async () => undefined,
  listSessions: async () => [],
  revokeSession: async () => undefined,
};

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: "default",
        ttl: 60_000,
        limit: 1_000,
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    { provide: AuthService, useValue: authServiceMock },
    {
      provide: EncryptionService,
      useValue: { decrypt: (value: string) => value },
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
class AuthThrottleIntegrationTestModule {}

describe("Auth route throttling integration", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthThrottleIntegrationTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 429 after login route-specific limit is exceeded", async () => {
    for (let i = 0; i < 10; i++) {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          password: "Secret123",
        }),
      });

      expect(response.status).toBe(200);
    }

    const blocked = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "user@example.com",
        password: "Secret123",
      }),
    });

    expect(blocked.status).toBe(429);
  });

  it("returns 429 after forgot-password route-specific limit is exceeded", async () => {
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${baseUrl}/auth/forgot-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" }),
      });

      expect(response.status).toBe(204);
    }

    const blocked = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });

    expect(blocked.status).toBe(429);
  });
});
