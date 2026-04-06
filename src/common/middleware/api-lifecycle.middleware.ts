import { NextFunction, Request, Response } from "express";
import { API_LIFECYCLE_CONFIG } from "../constants";

type ApiLifecycleStage = "active" | "deprecated" | "sunset" | "unsupported";

type ApiLifecycleRuntimeConfig = {
  currentVersion: string;
  supportedVersions: string[];
  deprecatedVersions: string[];
  sunsetVersions: string[];
  policyUrl: string;
  deprecationDate?: string;
  sunsetDate?: string;
};

function parseVersionList(
  raw: string | undefined,
  fallback: readonly string[],
): string[] {
  const parsed =
    raw
      ?.split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0) ?? [];

  if (parsed.length > 0) {
    return Array.from(new Set(parsed));
  }

  return [...fallback];
}

function toHttpDate(raw?: string): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toUTCString();
}

function resolveApiLifecycleConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiLifecycleRuntimeConfig {
  const currentVersion =
    env.API_CURRENT_VERSION?.trim() || API_LIFECYCLE_CONFIG.CURRENT_VERSION;

  const supportedVersions = parseVersionList(
    env.API_SUPPORTED_VERSIONS,
    API_LIFECYCLE_CONFIG.SUPPORTED_VERSIONS,
  );

  const deprecatedVersions = parseVersionList(
    env.API_DEPRECATED_VERSIONS,
    API_LIFECYCLE_CONFIG.DEPRECATED_VERSIONS,
  );

  const sunsetVersions = parseVersionList(
    env.API_SUNSET_VERSIONS,
    API_LIFECYCLE_CONFIG.SUNSET_VERSIONS,
  );

  return {
    currentVersion,
    supportedVersions,
    deprecatedVersions,
    sunsetVersions,
    policyUrl:
      env.API_LIFECYCLE_POLICY_URL?.trim() || API_LIFECYCLE_CONFIG.POLICY_URL,
    deprecationDate: env.API_VERSION_DEPRECATION_DATE?.trim(),
    sunsetDate: env.API_VERSION_SUNSET_DATE?.trim(),
  };
}

function extractApiVersion(path: string): string | null {
  const [cleanPath] = path.split("?");
  const segments = cleanPath.split("/").filter((segment) => segment.length > 0);

  if (segments.length < 2 || segments[0] !== "api") {
    return null;
  }

  return segments[1];
}

function resolveLifecycleStage(
  version: string,
  config: ApiLifecycleRuntimeConfig,
): ApiLifecycleStage {
  if (config.sunsetVersions.includes(version)) return "sunset";
  if (config.deprecatedVersions.includes(version)) return "deprecated";
  if (config.supportedVersions.includes(version)) return "active";
  return "unsupported";
}

export function createApiLifecycleMiddleware(
  config: ApiLifecycleRuntimeConfig = resolveApiLifecycleConfig(),
) {
  const deprecationHttpDate = toHttpDate(config.deprecationDate);
  const sunsetHttpDate = toHttpDate(config.sunsetDate);

  return function apiLifecycleMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const version = extractApiVersion(req.originalUrl);
    if (!version) {
      next();
      return;
    }

    const stage = resolveLifecycleStage(version, config);

    res.setHeader("x-api-version", version);
    res.setHeader("x-api-current-version", config.currentVersion);
    res.setHeader(
      "x-api-supported-versions",
      config.supportedVersions.join(","),
    );
    res.setHeader("x-api-lifecycle-stage", stage);
    res.setHeader("x-api-lifecycle-policy", config.policyUrl);

    if (stage === "deprecated" || stage === "sunset") {
      res.setHeader("Deprecation", deprecationHttpDate ?? "true");
      if (sunsetHttpDate) {
        res.setHeader("Sunset", sunsetHttpDate);
      }

      const warning =
        stage === "sunset"
          ? `API version ${version} is sunset. See ${config.policyUrl}`
          : sunsetHttpDate
            ? `API version ${version} is deprecated and sunsets on ${sunsetHttpDate}. See ${config.policyUrl}`
            : `API version ${version} is deprecated. See ${config.policyUrl}`;
      res.setHeader("Warning", `299 - "${warning}"`);
    }

    next();
  };
}

export const apiLifecycleMiddleware = createApiLifecycleMiddleware();
