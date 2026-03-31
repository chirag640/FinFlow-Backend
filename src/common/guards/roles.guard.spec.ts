import { describe, expect, it, jest } from "@jest/globals";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";

describe("RolesGuard", () => {
  it("allows access when no roles metadata is defined", () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    const context: any = {
      getHandler: () => "handler",
      getClass: () => "class",
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: "USER" } }),
      }),
    };

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows access when user has one of the required roles", () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(["ADMIN"]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    const context: any = {
      getHandler: () => "handler",
      getClass: () => "class",
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: "ADMIN" } }),
      }),
    };

    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects access when user lacks required role", () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(["ADMIN"]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    const context: any = {
      getHandler: () => "handler",
      getClass: () => "class",
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: "USER" } }),
      }),
    };

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
