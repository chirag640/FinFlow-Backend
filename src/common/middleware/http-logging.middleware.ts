import { Logger } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";

const logger = new Logger("HttpLogger");

const SENSITIVE_KEYS = new Set([
  "password",
  "newPassword",
  "confirmPassword",
  "token",
  "accessToken",
  "refreshToken",
  "otp",
  "code",
  "authorization",
]);

function redactSensitive(value: unknown): unknown {
  if (value == null) return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }

  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, fieldValue] of Object.entries(input)) {
      if (SENSITIVE_KEYS.has(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = redactSensitive(fieldValue);
      }
    }

    return output;
  }

  return value;
}

function serializePayload(payload: unknown): string {
  if (payload === undefined) return "undefined";
  if (typeof payload === "string") return payload;

  try {
    return JSON.stringify(payload);
  } catch {
    return "[UNSERIALIZABLE_PAYLOAD]";
  }
}

function capLogSize(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...[truncated ${text.length - maxChars} chars]`;
}

export function httpLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Avoid noisy probe logs in production and local dev.
  if (
    req.method === "HEAD" ||
    req.originalUrl === "/" ||
    req.originalUrl === "/health"
  ) {
    next();
    return;
  }

  const startedAt = Date.now();
  const requestId =
    (req as Request & { requestId?: string }).requestId ??
    req.header("x-request-id") ??
    "n/a";

  const redactedRequestBody = redactSensitive(req.body);
  logger.log(
    `[REQ] ${req.method} ${req.originalUrl} requestId=${requestId} body=${capLogSize(serializePayload(redactedRequestBody))}`,
  );

  let responsePayload: unknown;
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = ((body: unknown) => {
    responsePayload = body;
    return originalJson(body);
  }) as typeof res.json;

  res.send = ((body: unknown) => {
    if (responsePayload === undefined) {
      responsePayload = body;
    }
    return originalSend(body as never);
  }) as typeof res.send;

  res.on("finish", () => {
    const elapsedMs = Date.now() - startedAt;
    const redactedResponseBody = redactSensitive(responsePayload);
    const responseText = capLogSize(serializePayload(redactedResponseBody));
    const line =
      `[RES] ${req.method} ${req.originalUrl} requestId=${requestId} ` +
      `status=${res.statusCode} durationMs=${elapsedMs} body=${responseText}`;

    if (res.statusCode >= 500) {
      logger.error(line);
      return;
    }

    if (res.statusCode >= 400) {
      logger.warn(line);
      return;
    }

    logger.log(line);
  });

  next();
}
