import { Logger } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";

const logger = new Logger("HttpLogger");

type LogLevel = "log" | "warn" | "error";

type HttpLogRecord = {
  timestamp: string;
  level: "info" | "warn" | "error";
  event: "http_request" | "http_response";
  requestId: string;
  method: string;
  url: string;
  path: string;
  ip: string;
  userAgent: string;
  statusCode?: number;
  durationMs?: number;
  requestBody?: string;
  responseBody?: string;
};

const SENSITIVE_KEYS = new Set([
  "password",
  "newpassword",
  "oldpassword",
  "confirmpassword",
  "currentpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "otp",
  "otpcode",
  "code",
  "authorization",
  "pinhash",
  "pinverifierhash",
  "pinsalt",
  "secret",
  "apikey",
]);

function normalizeSensitiveKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function redactSensitive(value: unknown): unknown {
  if (value == null) return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }

  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, fieldValue] of Object.entries(input)) {
      if (SENSITIVE_KEYS.has(normalizeSensitiveKey(key))) {
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

function serializeAndCap(payload: unknown, maxChars = 4000): string {
  return capLogSize(serializePayload(payload), maxChars);
}

function emitStructuredLog(level: LogLevel, record: HttpLogRecord): void {
  const line = serializeAndCap(record, 8_000);
  if (level === "error") {
    logger.error(line);
    return;
  }
  if (level === "warn") {
    logger.warn(line);
    return;
  }
  logger.log(line);
}

export function httpLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const path = req.originalUrl.split("?")[0];
  const isHealthProbe =
    path === "/health" ||
    path === "/api/v1/health" ||
    path.startsWith("/api/v1/health/");

  // Avoid noisy probe logs in production and local dev.
  if (req.method === "HEAD" || path === "/" || isHealthProbe) {
    next();
    return;
  }

  const startedAt = Date.now();
  const requestId =
    (req as Request & { requestId?: string }).requestId ??
    req.header("x-request-id") ??
    "n/a";
  const ip = req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? req.ip;
  const userAgent = req.header("user-agent") ?? "unknown";

  const redactedRequestBody = redactSensitive(req.body);
  emitStructuredLog("log", {
    timestamp: new Date().toISOString(),
    level: "info",
    event: "http_request",
    requestId,
    method: req.method,
    url: req.originalUrl,
    path,
    ip,
    userAgent,
    requestBody: serializeAndCap(redactedRequestBody),
  });

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
    const responseBody = serializeAndCap(redactedResponseBody);

    const logRecord: HttpLogRecord = {
      timestamp: new Date().toISOString(),
      level:
        res.statusCode >= 500
          ? "error"
          : res.statusCode >= 400
            ? "warn"
            : "info",
      event: "http_response",
      requestId,
      method: req.method,
      url: req.originalUrl,
      path,
      ip,
      userAgent,
      statusCode: res.statusCode,
      durationMs: elapsedMs,
      responseBody,
    };

    if (res.statusCode >= 500) {
      emitStructuredLog("error", logRecord);
      return;
    }

    if (res.statusCode >= 400) {
      emitStructuredLog("warn", logRecord);
      return;
    }

    emitStructuredLog("log", logRecord);
  });

  next();
}
