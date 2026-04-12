import { createHash, randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { verify as verifyJwt } from "jsonwebtoken";

type IdempotencyEntry = {
  requestHash: string;
  statusCode: number;
  body: unknown;
  contentType?: string;
  expiresAt: number;
};

const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ITEMS = 2000;
const cache = new Map<string, IdempotencyEntry>();

let accessSecretCandidates: string[] | null = null;

function cleanupCache(now: number): void {
  for (const [k, v] of cache.entries()) {
    if (v.expiresAt <= now) cache.delete(k);
  }
  if (cache.size <= MAX_CACHE_ITEMS) return;

  const overshoot = cache.size - MAX_CACHE_ITEMS;
  let removed = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    removed += 1;
    if (removed >= overshoot) break;
  }
}

function getUserScope(req: Request): string {
  const user = (req as Request & { user?: Record<string, unknown> }).user;
  const userId =
    (typeof user?._id === "string" && user._id) ||
    (typeof user?.id === "string" && user.id);
  if (typeof userId === "string" && userId.length > 0) {
    return userId;
  }

  const tokenUserId = userIdFromBearerToken(req);
  if (tokenUserId) {
    return tokenUserId;
  }

  return "anonymous";
}

function userIdFromBearerToken(req: Request): string | null {
  const authHeader =
    (req.headers.authorization as string | undefined) ??
    req.header("authorization") ??
    req.header("Authorization") ??
    "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  for (const secret of resolveAccessSecrets()) {
    try {
      const payload = verifyJwt(token, secret, {
        ignoreExpiration: true,
      }) as { sub?: unknown };
      if (typeof payload?.sub === "string" && payload.sub.length > 0) {
        return payload.sub;
      }
    } catch {
      // Try next configured secret.
    }
  }

  return null;
}

function resolveAccessSecrets(): string[] {
  if (accessSecretCandidates) {
    return accessSecretCandidates;
  }

  const primary = process.env.JWT_SECRET?.trim();
  if (!primary) {
    accessSecretCandidates = [];
    return accessSecretCandidates;
  }

  const previous = (process.env.JWT_SECRET_PREVIOUS ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter((secret) => secret.length > 0 && secret !== primary);

  accessSecretCandidates = [primary, ...previous];
  return accessSecretCandidates;
}

function requestHash(req: Request, scope: string): string {
  const raw = JSON.stringify({
    scope,
    method: req.method,
    path: req.originalUrl,
    query: req.query,
    body: req.body,
  });
  return createHash("sha256").update(raw).digest("hex");
}

export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header("x-request-id")?.trim();
  const requestId = incoming && incoming.length > 0 ? incoming : randomUUID();
  (req as Request & { requestId?: string }).requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
}

export function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!["POST", "PATCH", "DELETE"].includes(req.method.toUpperCase())) {
    next();
    return;
  }

  const key = req.header("idempotency-key")?.trim();
  if (!key) {
    next();
    return;
  }

  const now = Date.now();
  cleanupCache(now);

  const scope = getUserScope(req);
  const cacheKey = `${scope}:${req.method}:${req.originalUrl}:${key}`;
  const hash = requestHash(req, scope);

  const existing = cache.get(cacheKey);
  if (existing && existing.expiresAt > now) {
    if (existing.requestHash !== hash) {
      res.status(409).json({
        statusCode: 409,
        message:
          "Idempotency-Key already used with a different request payload.",
      });
      return;
    }

    res.setHeader("x-idempotent-replay", "true");
    if (existing.contentType) {
      res.setHeader("content-type", existing.contentType);
    }

    if (typeof existing.body === "object") {
      res.status(existing.statusCode).json(existing.body as object);
      return;
    }

    res.status(existing.statusCode).send(existing.body as string);
    return;
  }

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let captured = false;

  const capture = (payload: unknown): void => {
    if (captured) return;
    captured = true;

    const statusCode = res.statusCode;
    if (statusCode < 200 || statusCode >= 500) return;

    cache.set(cacheKey, {
      requestHash: hash,
      statusCode,
      body: payload,
      contentType:
        typeof res.getHeader("content-type") === "string"
          ? (res.getHeader("content-type") as string)
          : undefined,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  };

  res.json = ((body: unknown) => {
    capture(body);
    return originalJson(body);
  }) as typeof res.json;

  res.send = ((body: unknown) => {
    capture(body);
    return originalSend(body as never);
  }) as typeof res.send;

  next();
}
