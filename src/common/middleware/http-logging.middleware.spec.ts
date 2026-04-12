import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Logger } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { httpLoggingMiddleware } from "./http-logging.middleware";

type MockResponse = Response & { triggerFinish: () => void };

function createRequest(params: {
  method?: string;
  originalUrl?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Request & { requestId?: string } {
  const headers = Object.fromEntries(
    Object.entries(params.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );

  return {
    method: params.method ?? "POST",
    originalUrl: params.originalUrl ?? "/api/v1/auth/login",
    ip: "127.0.0.1",
    body: params.body ?? {},
    headers,
    requestId: "req-logger-1",
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request & { requestId?: string };
}

function createResponse(statusCode = 200): MockResponse {
  const listeners: Array<() => void> = [];

  const response = {
    statusCode,
    json: (_body: unknown) => response,
    send: (_body: unknown) => response,
    status: (code: number) => {
      response.statusCode = code;
      return response;
    },
    on: (event: string, callback: () => void) => {
      if (event === "finish") listeners.push(callback);
      return response;
    },
    triggerFinish: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  } as unknown as MockResponse;

  return response;
}

describe("httpLoggingMiddleware", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("redacts normalized sensitive keys in request and response payloads", () => {
    const logSpy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);

    const req = createRequest({
      body: {
        currentPassword: "super-secret",
        nested: {
          "refresh-token": "refresh-secret",
          pin_salt: "pin-salt-secret",
          safeField: "safe-value",
        },
      },
    });

    const res = createResponse(200);
    const next = jest.fn(() => {
      res.status(200).json({
        token: "access-secret",
        profile: {
          api_key: "service-secret",
          label: "visible",
        },
      });
    }) as NextFunction;

    httpLoggingMiddleware(req, res, next);
    res.triggerFinish();

    expect(next).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(2);

    const requestRecord = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      requestBody: string;
    };
    const responseRecord = JSON.parse(logSpy.mock.calls[1][0] as string) as {
      responseBody: string;
    };

    const requestBody = JSON.parse(requestRecord.requestBody) as {
      currentPassword: string;
      nested: Record<string, string>;
    };
    const responseBody = JSON.parse(responseRecord.responseBody) as {
      token: string;
      profile: Record<string, string>;
    };

    expect(requestBody.currentPassword).toBe("[REDACTED]");
    expect(requestBody.nested["refresh-token"]).toBe("[REDACTED]");
    expect(requestBody.nested.pin_salt).toBe("[REDACTED]");
    expect(requestBody.nested.safeField).toBe("safe-value");

    expect(responseBody.token).toBe("[REDACTED]");
    expect(responseBody.profile.api_key).toBe("[REDACTED]");
    expect(responseBody.profile.label).toBe("visible");
  });

  it("uses warn level for 4xx responses", () => {
    const logSpy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    const warnSpy = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);

    const req = createRequest({
      method: "DELETE",
      originalUrl: "/api/v1/users/me",
      body: { currentPassword: "super-secret" },
    });
    const res = createResponse(401);
    const next = jest.fn(() => {
      res.status(401).json({
        message: "Unauthorized",
        authorization: "Bearer token",
      });
    }) as NextFunction;

    httpLoggingMiddleware(req, res, next);
    res.triggerFinish();

    expect(next).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const warnRecord = JSON.parse(warnSpy.mock.calls[0][0] as string) as {
      level: string;
      statusCode: number;
      responseBody: string;
    };
    const responseBody = JSON.parse(warnRecord.responseBody) as {
      message: string;
      authorization: string;
    };

    expect(warnRecord.level).toBe("warn");
    expect(warnRecord.statusCode).toBe(401);
    expect(responseBody.authorization).toBe("[REDACTED]");
  });

  it("skips logging health probes", () => {
    const logSpy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);

    const req = createRequest({
      method: "GET",
      originalUrl: "/api/v1/health",
    });
    const res = createResponse(200);
    const next = jest.fn() as NextFunction;

    httpLoggingMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
});
