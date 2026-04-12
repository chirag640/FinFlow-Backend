/**
 * Application-wide constants and configuration values
 *
 * This file centralizes all magic numbers and configuration values
 * to improve maintainability and prevent hardcoded values scattered
 * throughout the codebase.
 */

/**
 * Authentication and Security Configuration
 */
export const AUTH_CONFIG = {
  /**
   * Number of bcrypt salt rounds for password hashing
   * Higher values = more secure but slower
   */
  BCRYPT_ROUNDS_PASSWORD: 12,

  /**
   * Number of bcrypt salt rounds for OTP/verification code hashing
   * Slightly lower than password rounds for performance
   */
  BCRYPT_ROUNDS_OTP: 10,

  /**
   * Number of bcrypt rounds for persisted PIN verifier hashes.
   */
  BCRYPT_ROUNDS_PIN: 10,

  /**
   * JWT token expiry time in seconds
   * Default: 86400 seconds = 24 hours
   */
  JWT_EXPIRY_SECONDS: 86400,

  /**
   * OTP (One-Time Password) numeric range
   * MIN: 100000 (6-digit minimum)
   * MAX: 1000000 (exclusive, so max is 999999)
   */
  OTP_RANGE_MIN: 100000,
  OTP_RANGE_MAX: 1000000,

  /**
   * Failed PIN attempts before lockout starts.
   */
  PIN_MAX_FAILED_ATTEMPTS: 5,

  /**
   * Base lock duration (seconds) once PIN lockout threshold is reached.
   * Subsequent failures while locked use exponential backoff.
   */
  PIN_LOCK_BASE_SECONDS: 30,

  /**
   * Maximum PIN lock duration (seconds).
   */
  PIN_LOCK_MAX_SECONDS: 600,
} as const;

/**
 * Notification System Configuration
 */
export const NOTIFICATION_CONFIG = {
  /**
   * Threshold amount for large expense approval notifications
   * Default: 5000 (currency units)
   */
  LARGE_EXPENSE_THRESHOLD: 5000,

  /**
   * Budget alert percentage thresholds
   * Alerts triggered at 100%, 90%, and 70% of budget
   */
  BUDGET_ALERT_PERCENTAGES: [100, 90, 70] as const,

  /**
   * Goal milestone percentages used for engagement notifications.
   */
  GOAL_MILESTONE_PERCENTAGES: [25, 50, 75, 100] as const,

  /**
   * Deadline horizon (in days) for goal deadline reminder nudges.
   */
  GOAL_DEADLINE_SOON_DAYS: 7,

  /**
   * Number of inactivity days before stalled-goal nudges are sent.
   */
  GOAL_STALE_DAYS: 14,

  /**
   * Number of days of inactivity before sending inactive member notification
   * Default: 14 days
   */
  INACTIVITY_DAYS: 14,

  /**
   * Minimum total amount for category spike detection
   * Default: 300 (currency units)
   */
  CATEGORY_SPIKE_MIN_AMOUNT: 300,

  /**
   * Minimum missed days before recurring verification alert is triggered.
   */
  RECURRING_MISSING_MIN_DAYS: 2,

  /**
   * Lookback window for matching manual recurring logs without parent linkage.
   */
  RECURRING_MISSING_LOOKBACK_DAYS: 45,

  /**
   * FCM (Firebase Cloud Messaging) batch size for sending notifications
   * Maximum tokens to send in a single batch
   */
  FCM_BATCH_SIZE: 500,

  /**
   * End of day time constants (hours, minutes, seconds, milliseconds)
   * Used for setting time to 23:59:59.999
   */
  END_OF_DAY_HOURS: 23,
  END_OF_DAY_MINUTES: 59,
  END_OF_DAY_SECONDS: 59,
  END_OF_DAY_MILLISECONDS: 999,
} as const;

/**
 * Sync Service Configuration
 */
export const SYNC_CONFIG = {
  /**
   * Number of items to push per batch
   */
  PUSH_CHUNK_SIZE: 200,

  /**
   * Idempotency cache TTL in milliseconds
   * Default: 24 hours
   */
  IDEMPOTENCY_TTL_MS: 24 * 60 * 60_000,

  /**
   * Wait time for duplicate detection in milliseconds
   * Default: 2.5 seconds
   */
  IDEMPOTENCY_WAIT_MS: 2500,

  /**
   * Poll interval for checking duplicates in milliseconds
   * Default: 100ms
   */
  IDEMPOTENCY_POLL_MS: 100,

  /**
   * Pull response cache TTL in milliseconds
   * Default: 15 seconds
   */
  PULL_CACHE_TTL_MS: 15_000,

  /**
   * Watermark cache TTL in milliseconds
   * Default: 45 seconds
   */
  PULL_WATERMARK_TTL_MS: 45_000,

  /**
   * Suggested pull delay when user is active
   * Default: 20 seconds
   */
  PULL_SUGGESTED_DELAY_ACTIVE_MS: 20_000,

  /**
   * Suggested pull delay when user is idle
   * Default: 90 seconds
   */
  PULL_SUGGESTED_DELAY_IDLE_MS: 90_000,

  /**
   * Max entries retained in in-memory pull caches to avoid unbounded growth.
   */
  PULL_CACHE_MAX_ENTRIES: 1000,

  /**
   * Max entries retained in pull watermark map.
   */
  PULL_WATERMARK_MAX_ENTRIES: 2000,

  /**
   * Minimum number of samples required before error-rate anomaly checks are evaluated.
   */
  ANOMALY_MIN_SAMPLE_SIZE: 20,

  /**
   * Push error-rate anomaly threshold (ratio).
   */
  ANOMALY_PUSH_ERROR_RATE: 0.15,

  /**
   * Pull error-rate anomaly threshold (ratio).
   */
  ANOMALY_PULL_ERROR_RATE: 0.15,

  /**
   * Retry-rate anomaly threshold (ratio of retries to total sync ops).
   */
  ANOMALY_RETRY_RATE: 0.2,

  /**
   * Pull staleness anomaly threshold for p95 (milliseconds).
   */
  ANOMALY_PULL_STALENESS_P95_MS: 10 * 60_000,

  /**
   * Expired idempotency backlog anomaly threshold (record count).
   */
  ANOMALY_IDEMPOTENCY_BACKLOG: 100,
} as const;

/**
 * API version lifecycle policy defaults.
 */
export const API_LIFECYCLE_CONFIG = {
  CURRENT_VERSION: "v1",
  SUPPORTED_VERSIONS: ["v1"] as const,
  DEPRECATED_VERSIONS: [] as const,
  SUNSET_VERSIONS: [] as const,
  POLICY_URL: "/api/docs",
} as const;

/**
 * Time Constants
 */
export const TIME_CONSTANTS = {
  /**
   * Milliseconds in one day
   */
  ONE_DAY_MS: 86400000,

  /**
   * Seconds in one day
   */
  ONE_DAY_SECONDS: 86400,
} as const;

/**
 * Database Error Codes
 */
export const DB_ERROR_CODES = {
  /**
   * MongoDB duplicate key error code
   */
  MONGO_DUPLICATE_KEY_ERROR: 11000,
} as const;

/**
 * Soft-Delete Retention Configuration
 */
export const RETENTION_CONFIG = {
  /**
   * Days to retain soft-deleted records before permanent removal.
   * Default: 30 days
   */
  SOFT_DELETE_RETENTION_DAYS: 30,

  /**
   * Max records to permanently delete per cron run to avoid blocking.
   */
  PERMANENT_DELETE_BATCH_SIZE: 500,
} as const;

/**
 * Receipt upload/storage configuration
 */
export const RECEIPT_CONFIG = {
  /**
   * Maximum allowed receipt upload size in bytes.
   */
  MAX_UPLOAD_BYTES: 1_500_000,

  /**
   * Signed upload intent validity window.
   */
  INTENT_TTL_MS: 10 * 60_000,

  /**
   * Storage backend provider for receipt blobs.
   * Supported values: local, s3
   */
  STORAGE_PROVIDER:
    (process.env.RECEIPT_STORAGE_PROVIDER?.trim().toLowerCase() || "local") as
      | "local"
      | "s3",

  /**
   * Base URL used for publicly addressable receipt links.
   * Example: https://cdn.example.com
   */
  PUBLIC_BASE_URL: process.env.RECEIPT_PUBLIC_BASE_URL?.trim() || "",

  /**
   * Whether receipt links should be signed and short-lived.
   */
  SIGN_READ_URLS:
    process.env.RECEIPT_SIGN_READ_URLS?.trim().toLowerCase() !== "false",

  /**
   * Signed-read URL TTL in seconds (parsed in service with validation).
   */
  SIGNED_READ_TTL_SECONDS:
    process.env.RECEIPT_SIGNED_READ_TTL_SECONDS?.trim() || "900",

  /**
   * Local object storage root (relative to process cwd unless absolute).
   */
  STORAGE_ROOT_DIR: process.env.RECEIPT_STORAGE_DIR?.trim() || "storage",

  /**
   * S3-compatible storage settings (used when STORAGE_PROVIDER=s3).
   */
  S3_BUCKET: process.env.RECEIPT_S3_BUCKET?.trim() || "",
  S3_REGION: process.env.RECEIPT_S3_REGION?.trim() || "",
  S3_ENDPOINT: process.env.RECEIPT_S3_ENDPOINT?.trim() || "",
  S3_ACCESS_KEY_ID: process.env.RECEIPT_S3_ACCESS_KEY_ID?.trim() || "",
  S3_SECRET_ACCESS_KEY: process.env.RECEIPT_S3_SECRET_ACCESS_KEY?.trim() || "",
  S3_KEY_PREFIX: process.env.RECEIPT_S3_KEY_PREFIX?.trim() || "receipts",
  S3_FORCE_PATH_STYLE:
    process.env.RECEIPT_S3_FORCE_PATH_STYLE?.trim().toLowerCase() === "true",

  /**
   * MIME types accepted for receipt uploads.
   */
  ALLOWED_MIME_TYPES: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
  ] as const,
} as const;
