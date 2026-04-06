import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { randomUUID } from "crypto";
import { DatabaseService } from "../../database/database.service";
import { EmailOutboxDoc } from "../../database/database.types";

export type OutboundEmailPayload = {
  to: string;
  subject: string;
  html: string;
};

type EmailQueueOptions = {
  purpose: string;
  userId?: string;
  maxRetries?: number;
  expiresInMs?: number;
};

/**
 * EmailQueueService provides a persistent retry queue for email delivery.
 *
 * Features:
 * - Immediate delivery attempt with automatic fallback to queue
 * - Exponential backoff for retries (1min, 5min, 15min, 1hr)
 * - TTL-based expiration for queued emails
 * - Cron-based retry processing
 */
@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);

  private static readonly DEFAULT_MAX_RETRIES = 5;
  private static readonly DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly RETRY_DELAYS_MS = [
    60_000, // 1 min
    5 * 60_000, // 5 min
    15 * 60_000, // 15 min
    60 * 60_000, // 1 hr
    4 * 60 * 60_000, // 4 hr
  ];

  constructor(private readonly db: DatabaseService) {}

  /**
   * Queue an email for delivery. Attempts immediate send first,
   * then queues for retry if immediate send fails.
   */
  async queueEmail(
    payload: OutboundEmailPayload,
    options: EmailQueueOptions,
  ): Promise<{ queued: boolean; sent: boolean; id: string }> {
    const id = randomUUID();
    const now = new Date();
    const _maxRetries =
      options.maxRetries ?? EmailQueueService.DEFAULT_MAX_RETRIES;
    const expiresAt = new Date(
      now.getTime() + (options.expiresInMs ?? EmailQueueService.DEFAULT_TTL_MS),
    );

    // Try immediate delivery
    const immediateResult = await this.attemptDelivery(payload);

    if (immediateResult.success) {
      // Record as sent for audit trail
      await this.db.emailOutbox.insertOne({
        _id: id,
        createdAt: now,
        updatedAt: now,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        purpose: options.purpose,
        userId: options.userId ?? null,
        status: "sent",
        attempts: 1,
        lastAttemptAt: now,
        lastError: null,
        nextRetryAt: null,
        expiresAt,
      });

      return { queued: false, sent: true, id };
    }

    // Queue for retry
    const nextRetryAt = this.calculateNextRetry(0);
    await this.db.emailOutbox.insertOne({
      _id: id,
      createdAt: now,
      updatedAt: now,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      purpose: options.purpose,
      userId: options.userId ?? null,
      status: "pending",
      attempts: 1,
      lastAttemptAt: now,
      lastError: immediateResult.error ?? "Unknown error",
      nextRetryAt,
      expiresAt,
    });

    this.logger.warn(
      `Email queued for retry: ${options.purpose} to ${payload.to} (id=${id})`,
    );

    return { queued: true, sent: false, id };
  }

  /**
   * Process pending emails that are due for retry.
   * Runs every 2 minutes.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processRetryQueue(): Promise<void> {
    const now = new Date();

    // Find emails due for retry
    const pendingEmails = await this.db.emailOutbox
      .find({
        status: "pending",
        nextRetryAt: { $lte: now },
      })
      .limit(20)
      .toArray();

    if (pendingEmails.length === 0) return;

    this.logger.log(`Processing ${pendingEmails.length} queued emails`);

    for (const email of pendingEmails) {
      await this.processQueuedEmail(email);
    }
  }

  private async processQueuedEmail(email: EmailOutboxDoc): Promise<void> {
    const payload: OutboundEmailPayload = {
      to: email.to,
      subject: email.subject,
      html: email.html,
    };

    const result = await this.attemptDelivery(payload);
    const now = new Date();
    const attempts = email.attempts + 1;

    if (result.success) {
      await this.db.emailOutbox.updateOne(
        { _id: email._id },
        {
          $set: {
            status: "sent",
            attempts,
            lastAttemptAt: now,
            lastError: null,
            nextRetryAt: null,
            updatedAt: now,
          },
        },
      );
      this.logger.log(
        `Email delivered on retry ${attempts}: ${email.purpose} to ${email.to}`,
      );
      return;
    }

    // Check if we should give up
    if (attempts >= EmailQueueService.DEFAULT_MAX_RETRIES) {
      await this.db.emailOutbox.updateOne(
        { _id: email._id },
        {
          $set: {
            status: "failed",
            attempts,
            lastAttemptAt: now,
            lastError: result.error ?? "Max retries exceeded",
            nextRetryAt: null,
            updatedAt: now,
          },
        },
      );
      this.logger.error(
        `Email permanently failed after ${attempts} attempts: ${email.purpose} to ${email.to}`,
      );
      return;
    }

    // Schedule next retry
    const nextRetryAt = this.calculateNextRetry(attempts);
    await this.db.emailOutbox.updateOne(
      { _id: email._id },
      {
        $set: {
          attempts,
          lastAttemptAt: now,
          lastError: result.error ?? "Unknown error",
          nextRetryAt,
          updatedAt: now,
        },
      },
    );
  }

  private async attemptDelivery(
    payload: OutboundEmailPayload,
  ): Promise<{ success: boolean; error?: string }> {
    const resendApiKey = process.env.RESEND_API_KEY?.trim();
    if (!resendApiKey) {
      return { success: false, error: "RESEND_API_KEY not configured" };
    }

    const from = this.resolveFromAddress();
    const resendBaseUrl =
      process.env.RESEND_API_BASE_URL?.trim() ?? "https://api.resend.com";
    const endpoint = `${resendBaseUrl.replace(/\/$/, "")}/emails`;
    const requestTimeoutMs = Number(
      process.env.RESEND_REQUEST_TIMEOUT_MS ?? 12_000,
    );

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, requestTimeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
        }),
        signal: abortController.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const details = await res.text();
        return { success: false, error: `Resend ${res.status}: ${details}` };
      }

      return { success: true };
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  private resolveFromAddress(): string {
    const fromName = process.env.EMAIL_FROM_NAME?.trim() ?? "FinFlow";
    const fromEmail =
      process.env.EMAIL_FROM_ADDRESS?.trim() ?? "noreply@finflow.app";
    return `${fromName} <${fromEmail}>`;
  }

  private calculateNextRetry(attempts: number): Date {
    const delayIndex = Math.min(
      attempts,
      EmailQueueService.RETRY_DELAYS_MS.length - 1,
    );
    const delayMs = EmailQueueService.RETRY_DELAYS_MS[delayIndex];
    return new Date(Date.now() + delayMs);
  }

  /**
   * Get queue statistics for health monitoring.
   */
  async getQueueStats(): Promise<{
    pending: number;
    failed: number;
    sent24h: number;
  }> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [pending, failed, sent24h] = await Promise.all([
      this.db.emailOutbox.countDocuments({ status: "pending" }),
      this.db.emailOutbox.countDocuments({ status: "failed" }),
      this.db.emailOutbox.countDocuments({
        status: "sent",
        updatedAt: { $gte: oneDayAgo },
      }),
    ]);

    return { pending, failed, sent24h };
  }
}
