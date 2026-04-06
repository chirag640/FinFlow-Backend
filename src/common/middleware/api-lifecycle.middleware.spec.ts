import { describe, expect, it, jest } from "@jest/globals";
import { NextFunction, Request, Response } from "express";
import { createApiLifecycleMiddleware } from "./api-lifecycle.middleware";

function mockRequest(url: string): Request {
  return {
    originalUrl: url,
  } as Request;
}

function mockResponse(): {
  response: Response;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};

  const response = {
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
      return response;
    },
  } as unknown as Response;

  return { response, headers };
}

describe("apiLifecycleMiddleware", () => {
  it("adds lifecycle headers for active API version", () => {
    const middleware = createApiLifecycleMiddleware({
      currentVersion: "v1",
      supportedVersions: ["v1"],
      deprecatedVersions: [],
      sunsetVersions: [],
      policyUrl: "https://docs.finflow.dev/api-lifecycle",
    });

    const req = mockRequest("/api/v1/auth/login");
    const { response, headers } = mockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, response, next);

    expect(headers["x-api-version"]).toBe("v1");
    expect(headers["x-api-current-version"]).toBe("v1");
    expect(headers["x-api-supported-versions"]).toBe("v1");
    expect(headers["x-api-lifecycle-stage"]).toBe("active");
    expect(headers["x-api-lifecycle-policy"]).toBe(
      "https://docs.finflow.dev/api-lifecycle",
    );
    expect(headers.deprecation).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("does not add API lifecycle headers for non-versioned route", () => {
    const middleware = createApiLifecycleMiddleware({
      currentVersion: "v1",
      supportedVersions: ["v1"],
      deprecatedVersions: [],
      sunsetVersions: [],
      policyUrl: "https://docs.finflow.dev/api-lifecycle",
    });

    const req = mockRequest("/health");
    const { response, headers } = mockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, response, next);

    expect(headers["x-api-version"]).toBeUndefined();
    expect(headers["x-api-lifecycle-stage"]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("marks deprecated versions with deprecation and sunset headers", () => {
    const middleware = createApiLifecycleMiddleware({
      currentVersion: "v2",
      supportedVersions: ["v1", "v2"],
      deprecatedVersions: ["v1"],
      sunsetVersions: [],
      policyUrl: "https://docs.finflow.dev/api-lifecycle",
      deprecationDate: "2026-04-01T00:00:00.000Z",
      sunsetDate: "2026-12-31T23:59:59.000Z",
    });

    const req = mockRequest("/api/v1/expenses");
    const { response, headers } = mockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, response, next);

    expect(headers["x-api-lifecycle-stage"]).toBe("deprecated");
    expect(headers.deprecation).toBe("Wed, 01 Apr 2026 00:00:00 GMT");
    expect(headers.sunset).toBe("Thu, 31 Dec 2026 23:59:59 GMT");
    expect(headers.warning).toContain("deprecated");
    expect(next).toHaveBeenCalled();
  });

  it("labels unknown versions as unsupported", () => {
    const middleware = createApiLifecycleMiddleware({
      currentVersion: "v1",
      supportedVersions: ["v1"],
      deprecatedVersions: [],
      sunsetVersions: [],
      policyUrl: "https://docs.finflow.dev/api-lifecycle",
    });

    const req = mockRequest("/api/v3/expenses");
    const { response, headers } = mockResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, response, next);

    expect(headers["x-api-lifecycle-stage"]).toBe("unsupported");
    expect(next).toHaveBeenCalled();
  });
});
