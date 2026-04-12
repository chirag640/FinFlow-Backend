import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { INestApplication, Module, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import "reflect-metadata";
import { EncryptionService } from "../../common/services/encryption.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

const MISSING_SESSION_ID = "00000000-0000-0000-0000-000000000404";
const ACTIVE_SESSION_ID = "00000000-0000-0000-0000-000000000111";

describe("Auth session revoke integration", () => {
  let app: INestApplication;
  let baseUrl: string;
  let revokedSessions: string[];

  beforeEach(async () => {
    revokedSessions = [];

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
      revokeSession: async (userId: string, sessionId: string) => {
        if (sessionId === MISSING_SESSION_ID) {
          throw new NotFoundException("Session not found");
        }
        revokedSessions.push(`${userId}:${sessionId}`);
      },
    };

    @Module({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        {
          provide: EncryptionService,
          useValue: { decrypt: (value: string) => value },
        },
      ],
    })
    class AuthSessionRevokeIntegrationTestModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [AuthSessionRevokeIntegrationTestModule],
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

  it("returns 404 when the requested session does not exist", async () => {
    const response = await fetch(`${baseUrl}/auth/sessions/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: MISSING_SESSION_ID }),
    });

    expect(response.status).toBe(404);
    expect(revokedSessions).toHaveLength(0);
  });

  it("returns 204 and revokes the owned session", async () => {
    const response = await fetch(`${baseUrl}/auth/sessions/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: ACTIVE_SESSION_ID }),
    });

    expect(response.status).toBe(204);
    expect(revokedSessions).toEqual([`u1:${ACTIVE_SESSION_ID}`]);
  });
});
