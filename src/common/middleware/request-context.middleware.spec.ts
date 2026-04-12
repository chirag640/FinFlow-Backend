import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NextFunction, Request, Response } from "express";
import { sign } from "jsonwebtoken";
import {
  idempotencyMiddleware,
  requestContextMiddleware,
} from "./request-context.middleware";

type MutableRequest = Request & { requestId?: string; user?: { id?: string } };

type MockResponseState = {
  headers: Record<string, string>;
  statusCode: number;
  jsonBody: unknown;
  sendBody: unknown;
};

function createRequest(params: {
  method?: string;
  originalUrl?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
  user?: { id?: string };
}): MutableRequest {
  const headers = Object.fromEntries(
    Object.entries(params.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );

  return {
    method: params.method ?? "POST",
    originalUrl: params.originalUrl ?? "/api/v1/sync/push",
    headers,
    body: params.body ?? {},
    query: params.query ?? {},
    user: params.user,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as MutableRequest;
}

function createResponse(): { response: Response; state: MockResponseState } {
  const state: MockResponseState = {
    headers: {},
    statusCode: 200,
    jsonBody: undefined,
    sendBody: undefined,
  };

  const response = {
    statusCode: 200,
    setHeader: (name: string, value: string) => {
      state.headers[name.toLowerCase()] = String(value);
      return response;
    },
    getHeader: (name: string) => state.headers[name.toLowerCase()],
    status: (code: number) => {
      state.statusCode = code;
      response.statusCode = code;
      return response;
    },
    json: (body: unknown) => {
      state.jsonBody = body;
      return response;
    },
    send: (body: unknown) => {
      state.sendBody = body;
      return response;
    },
  } as unknown as Response;

  return { response, state };
}

function withJwtSecret<T>(fn: () => T): T {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-access-secret";

  try {
    return fn();
  } finally {
    process.env.JWT_SECRET = previousSecret;
  }
}

describe("requestContextMiddleware", () => {
  it("uses incoming x-request-id header when present", () => {
    const req = createRequest({
      method: "GET",
      headers: { "x-request-id": "req-custom-123" },
    });
    const { response, state } = createResponse();
    const next = jest.fn() as NextFunction;

    requestContextMiddleware(req, response, next);

    expect(req.requestId).toBe("req-custom-123");
    expect(state.headers["x-request-id"]).toBe("req-custom-123");
    expect(next).toHaveBeenCalled();
  });

  it("generates and forwards request id when missing", () => {
    const req = createRequest({ method: "GET" });
    const { response, state } = createResponse();
    const next = jest.fn() as NextFunction;

    requestContextMiddleware(req, response, next);

    expect(typeof req.requestId).toBe("string");
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(state.headers["x-request-id"]).toBe(req.requestId);
    expect(next).toHaveBeenCalled();
  });
});

describe("idempotencyMiddleware", () => {
  beforeEach(() => {
    delete process.env.JWT_SECRET_PREVIOUS;
  });

  it("replays duplicate request for same bearer-token user scope", () =>
    withJwtSecret(() => {
      const token = sign({ sub: "user-a" }, "test-access-secret", {
        expiresIn: "1h",
      });

      const requestA = createRequest({
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": "idem-scope-replay",
        },
        body: { amount: 100, category: "food" },
      });
      const first = createResponse();
      const firstNext = jest.fn(() => {
        first.response.status(201).json({ ok: true, source: "first" });
      }) as NextFunction;

      idempotencyMiddleware(requestA, first.response, firstNext);

      const requestB = createRequest({
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": "idem-scope-replay",
        },
        body: { amount: 100, category: "food" },
      });
      const replay = createResponse();
      const replayNext = jest.fn() as NextFunction;

      idempotencyMiddleware(requestB, replay.response, replayNext);

      expect(firstNext).toHaveBeenCalledTimes(1);
      expect(replayNext).not.toHaveBeenCalled();
      expect(replay.state.headers["x-idempotent-replay"]).toBe("true");
      expect(replay.state.statusCode).toBe(201);
      expect(replay.state.jsonBody).toEqual({ ok: true, source: "first" });
    }));

  it("isolates cache scope by bearer-token subject", () =>
    withJwtSecret(() => {
      const userAToken = sign({ sub: "user-a" }, "test-access-secret", {
        expiresIn: "1h",
      });
      const userBToken = sign({ sub: "user-b" }, "test-access-secret", {
        expiresIn: "1h",
      });

      const requestA = createRequest({
        headers: {
          authorization: `Bearer ${userAToken}`,
          "idempotency-key": "idem-scope-isolation",
        },
        body: { amount: 100, category: "food" },
      });
      const first = createResponse();
      const firstNext = jest.fn(() => {
        first.response.status(201).json({ ok: true, source: "user-a" });
      }) as NextFunction;

      idempotencyMiddleware(requestA, first.response, firstNext);

      const requestB = createRequest({
        headers: {
          authorization: `Bearer ${userBToken}`,
          "idempotency-key": "idem-scope-isolation",
        },
        body: { amount: 100, category: "food" },
      });
      const second = createResponse();
      const secondNext = jest.fn(() => {
        second.response.status(201).json({ ok: true, source: "user-b" });
      }) as NextFunction;

      idempotencyMiddleware(requestB, second.response, secondNext);

      expect(secondNext).toHaveBeenCalledTimes(1);
      expect(second.state.headers["x-idempotent-replay"]).toBeUndefined();
      expect(second.state.jsonBody).toEqual({ ok: true, source: "user-b" });
    }));

  it("returns conflict when same key is reused with different payload", () =>
    withJwtSecret(() => {
      const token = sign({ sub: "user-c" }, "test-access-secret", {
        expiresIn: "1h",
      });

      const requestA = createRequest({
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": "idem-payload-conflict",
        },
        body: { amount: 100, category: "food" },
      });
      const first = createResponse();
      const firstNext = jest.fn(() => {
        first.response.status(201).json({ ok: true });
      }) as NextFunction;

      idempotencyMiddleware(requestA, first.response, firstNext);

      const requestB = createRequest({
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": "idem-payload-conflict",
        },
        body: { amount: 120, category: "food" },
      });
      const conflict = createResponse();
      const conflictNext = jest.fn() as NextFunction;

      idempotencyMiddleware(requestB, conflict.response, conflictNext);

      expect(conflictNext).not.toHaveBeenCalled();
      expect(conflict.state.statusCode).toBe(409);
      expect(conflict.state.jsonBody).toEqual({
        statusCode: 409,
        message:
          "Idempotency-Key already used with a different request payload.",
      });
    }));
});
