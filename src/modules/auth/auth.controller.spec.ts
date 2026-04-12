import { describe, expect, it } from "@jest/globals";
import "reflect-metadata";
import { AuthController } from "./auth.controller";

const THROTTLER_LIMIT = "THROTTLER:LIMIT";
const THROTTLER_TTL = "THROTTLER:TTL";

type ThrottleCase = {
  method:
    | "register"
    | "login"
    | "verifyEmail"
    | "resendOtp"
    | "forgotPassword"
    | "resetPassword";
  limit: number;
  ttl: number;
};

type DecoratedHandler = (...args: unknown[]) => unknown;

const THROTTLE_CASES: ThrottleCase[] = [
  { method: "register", ttl: 60_000, limit: 3 },
  { method: "login", ttl: 60_000, limit: 10 },
  { method: "verifyEmail", ttl: 60_000, limit: 10 },
  { method: "resendOtp", ttl: 3_600_000, limit: 3 },
  { method: "forgotPassword", ttl: 3_600_000, limit: 3 },
  { method: "resetPassword", ttl: 3_600_000, limit: 10 },
];

describe("AuthController throttling", () => {
  it.each(THROTTLE_CASES)(
    "applies expected throttle to $method",
    ({ method, limit, ttl }) => {
      const handler = AuthController.prototype[method] as DecoratedHandler;

      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(
        limit,
      );
      expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(ttl);
    },
  );

  it("does not apply method throttle metadata to refresh and logout", () => {
    const refreshHandler = AuthController.prototype.refresh as DecoratedHandler;
    const logoutHandler = AuthController.prototype.logout as DecoratedHandler;

    expect(
      Reflect.getMetadata(`${THROTTLER_LIMIT}default`, refreshHandler),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(`${THROTTLER_TTL}default`, refreshHandler),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(`${THROTTLER_LIMIT}default`, logoutHandler),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(`${THROTTLER_TTL}default`, logoutHandler),
    ).toBeUndefined();
  });
});
