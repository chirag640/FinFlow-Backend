import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { createHash, randomUUID } from "crypto";
import { AnyBulkWriteOperation } from "mongodb";
import { SYNC_CONFIG } from "../../common/constants";
import { EncryptionService } from "../../common/services/encryption.service";
import { DatabaseService } from "../../database/database.service";
import {
  BudgetDoc,
  ExpenseDoc,
  GoalDoc,
  SyncPushIdempotencyDoc,
  UserDoc,
} from "../../database/database.types";
import { SYNC_PROTOCOL_VERSION, SyncPushDto } from "./dto/sync.dto";
import { SyncMetricsService } from "./sync-metrics.service";

type EntityAck = {
  appliedUpserts: string[];
  appliedDeletions: string[];
  skippedUpserts: string[];
  skippedDeletions: string[];
};

type SyncPushAck = {
  expenses: EntityAck;
  budgets: EntityAck;
  goals: EntityAck;
};

type SyncPushResponse = {
  syncVersion: number;
  synced: {
    expenses: number;
    budgets: number;
    goals: number;
  };
  ack: SyncPushAck;
  timestamp: string;
};

type SyncUserProjection = Pick<
  UserDoc,
  | "_id"
  | "name"
  | "email"
  | "avatarUrl"
  | "currency"
  | "monthlyBudget"
  | "emailVerified"
  | "updatedAt"
>;

type SyncPullResponse = {
  syncVersion: number;
  expenses: Array<Record<string, unknown>>;
  budgets: Array<Record<string, unknown>>;
  goals: Array<Record<string, unknown>>;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    currency: string;
    monthlyBudget: number;
    emailVerified: boolean;
  } | null;
  serverTime: string;
  suggestedPullDelayMs?: number;
  unchanged?: boolean;
};

type TelemetryAnomaly = {
  code: string;
  severity: "warning" | "critical";
  message: string;
  observed: number;
  threshold: number;
  unit: "ratio" | "ms" | "count";
};

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private static readonly SUPPORTED_SYNC_VERSION = SYNC_PROTOCOL_VERSION;

  private static readonly PUSH_CHUNK_SIZE = SYNC_CONFIG.PUSH_CHUNK_SIZE;
  private static readonly IDEMPOTENCY_TTL_MS = SYNC_CONFIG.IDEMPOTENCY_TTL_MS;
  private static readonly IDEMPOTENCY_WAIT_MS = SYNC_CONFIG.IDEMPOTENCY_WAIT_MS;
  private static readonly IDEMPOTENCY_POLL_MS = SYNC_CONFIG.IDEMPOTENCY_POLL_MS;
  private static readonly PULL_CACHE_TTL_MS = SYNC_CONFIG.PULL_CACHE_TTL_MS;
  private static readonly PULL_WATERMARK_TTL_MS =
    SYNC_CONFIG.PULL_WATERMARK_TTL_MS;
  private static readonly PULL_SUGGESTED_DELAY_ACTIVE_MS =
    SYNC_CONFIG.PULL_SUGGESTED_DELAY_ACTIVE_MS;
  private static readonly PULL_SUGGESTED_DELAY_IDLE_MS =
    SYNC_CONFIG.PULL_SUGGESTED_DELAY_IDLE_MS;
  private static readonly PULL_CACHE_MAX_ENTRIES =
    SYNC_CONFIG.PULL_CACHE_MAX_ENTRIES;
  private static readonly PULL_WATERMARK_MAX_ENTRIES =
    SYNC_CONFIG.PULL_WATERMARK_MAX_ENTRIES;
  private static readonly ANOMALY_MIN_SAMPLE_SIZE =
    SYNC_CONFIG.ANOMALY_MIN_SAMPLE_SIZE;
  private static readonly ANOMALY_PUSH_ERROR_RATE =
    SYNC_CONFIG.ANOMALY_PUSH_ERROR_RATE;
  private static readonly ANOMALY_PULL_ERROR_RATE =
    SYNC_CONFIG.ANOMALY_PULL_ERROR_RATE;
  private static readonly ANOMALY_RETRY_RATE = SYNC_CONFIG.ANOMALY_RETRY_RATE;
  private static readonly ANOMALY_PULL_STALENESS_P95_MS =
    SYNC_CONFIG.ANOMALY_PULL_STALENESS_P95_MS;
  private static readonly ANOMALY_IDEMPOTENCY_BACKLOG =
    SYNC_CONFIG.ANOMALY_IDEMPOTENCY_BACKLOG;

  private readonly pullCache = new Map<
    string,
    { expiresAt: number; response: SyncPullResponse }
  >();
  private readonly inFlightPulls = new Map<string, Promise<SyncPullResponse>>();
  private readonly pullWatermarks = new Map<
    string,
    { latestMutationAtMs: number; checkedAtMs: number }
  >();

  constructor(
    private db: DatabaseService,
    private encryption: EncryptionService,
    private metrics: SyncMetricsService,
  ) {}

  private _chunk<T>(items: T[], size: number): T[][] {
    if (items.length == 0) return [];
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  private _newEntityAck(): EntityAck {
    return {
      appliedUpserts: [],
      appliedDeletions: [],
      skippedUpserts: [],
      skippedDeletions: [],
    };
  }

  private _recordAck(
    ack: EntityAck,
    id: string,
    deleted: boolean,
    applied: boolean,
  ): void {
    if (deleted) {
      if (applied) {
        ack.appliedDeletions.push(id);
      } else {
        ack.skippedDeletions.push(id);
      }
      return;
    }

    if (applied) {
      ack.appliedUpserts.push(id);
    } else {
      ack.skippedUpserts.push(id);
    }
  }

  private _serializeUser(user: SyncUserProjection | null) {
    if (!user) return null;
    return {
      id: user._id,
      name: this.encryption.decrypt(user.name),
      email: user.email,
      avatarUrl: user.avatarUrl,
      currency: user.currency,
      monthlyBudget: user.monthlyBudget,
      emailVerified: user.emailVerified,
    };
  }

  private _maxDate(values: Array<Date | null | undefined>): Date | null {
    const valid = values.filter(
      (value): value is Date => value instanceof Date,
    );
    if (valid.length === 0) return null;
    return valid.reduce((latest, current) =>
      current.getTime() > latest.getTime() ? current : latest,
    );
  }

  private _pullCacheKey(
    userId: string,
    sinceDate: Date,
    syncVersion: number,
  ): string {
    return `${userId}:${syncVersion}:${sinceDate.toISOString()}`;
  }

  private _resolveSyncVersion(syncVersion?: number): number {
    const resolved = syncVersion ?? SyncService.SUPPORTED_SYNC_VERSION;
    if (resolved !== SyncService.SUPPORTED_SYNC_VERSION) {
      throw new BadRequestException(
        `Unsupported syncVersion ${resolved}. Supported version: ${SyncService.SUPPORTED_SYNC_VERSION}`,
      );
    }
    return resolved;
  }

  private _getPullCache(key: string): SyncPullResponse | null {
    const cached = this.pullCache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.pullCache.delete(key);
      return null;
    }
    return cached.response;
  }

  private _setPullCache(key: string, response: SyncPullResponse): void {
    if (this.pullCache.size >= SyncService.PULL_CACHE_MAX_ENTRIES) {
      const oldestKey = this.pullCache.keys().next().value as
        | string
        | undefined;
      if (oldestKey) this.pullCache.delete(oldestKey);
    }
    this.pullCache.set(key, {
      expiresAt: Date.now() + SyncService.PULL_CACHE_TTL_MS,
      response,
    });
  }

  private _invalidatePullCacheForUser(userId: string): void {
    for (const key of this.pullCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.pullCache.delete(key);
      }
    }
    for (const key of this.inFlightPulls.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.inFlightPulls.delete(key);
      }
    }
    this._markUserMutation(userId);
  }

  private _markUserMutation(userId: string, at = new Date()): void {
    if (
      !this.pullWatermarks.has(userId) &&
      this.pullWatermarks.size >= SyncService.PULL_WATERMARK_MAX_ENTRIES
    ) {
      const oldestKey = this.pullWatermarks.keys().next().value as
        | string
        | undefined;
      if (oldestKey) this.pullWatermarks.delete(oldestKey);
    }
    const atMs = at.getTime();
    this.pullWatermarks.set(userId, {
      latestMutationAtMs: atMs,
      checkedAtMs: atMs,
    });
  }

  private _setPullWatermark(
    userId: string,
    latestMutationAt: Date | null,
  ): void {
    if (
      !this.pullWatermarks.has(userId) &&
      this.pullWatermarks.size >= SyncService.PULL_WATERMARK_MAX_ENTRIES
    ) {
      const oldestKey = this.pullWatermarks.keys().next().value as
        | string
        | undefined;
      if (oldestKey) this.pullWatermarks.delete(oldestKey);
    }
    const nowMs = Date.now();
    this.pullWatermarks.set(userId, {
      latestMutationAtMs: latestMutationAt?.getTime() ?? 0,
      checkedAtMs: nowMs,
    });
  }

  private _getPullWatermark(
    userId: string,
  ): { latestMutationAtMs: number; checkedAtMs: number } | null {
    const watermark = this.pullWatermarks.get(userId);
    if (!watermark) return null;

    if (
      Date.now() - watermark.checkedAtMs >
      SyncService.PULL_WATERMARK_TTL_MS
    ) {
      this.pullWatermarks.delete(userId);
      return null;
    }

    return watermark;
  }

  private _unchangedPullResponse(syncVersion: number): SyncPullResponse {
    return {
      syncVersion,
      expenses: [],
      budgets: [],
      goals: [],
      user: null,
      serverTime: new Date().toISOString(),
      suggestedPullDelayMs: SyncService.PULL_SUGGESTED_DELAY_IDLE_MS,
      unchanged: true,
    };
  }

  private _pushRequestHash(
    userId: string,
    dto: SyncPushDto,
    syncVersion: number,
  ): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          userId,
          syncVersion,
          expenses: dto.expenses ?? [],
          budgets: dto.budgets ?? [],
          goals: dto.goals ?? [],
        }),
      )
      .digest("hex");
  }

  private async _resolveIdempotencyReplay(
    userId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<SyncPushResponse | null> {
    const now = new Date();
    const doc: SyncPushIdempotencyDoc = {
      _id: randomUUID(),
      userId,
      idempotencyKey,
      requestHash,
      status: "processing",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + SyncService.IDEMPOTENCY_TTL_MS),
    };

    try {
      await this.db.syncPushIdempotency.insertOne(doc);
      this.metrics.recordIdempotencyMiss();
      return null;
    } catch (error: unknown) {
      const mongoErr = error as { code?: number };
      if (mongoErr.code !== 11000) {
        throw error;
      }

      const existing = await this.db.syncPushIdempotency.findOne({
        userId,
        idempotencyKey,
      });
      if (!existing) {
        return null;
      }

      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          "idempotency-key already used with a different sync payload",
        );
      }

      if (existing.status === "completed" && existing.response) {
        this.metrics.recordIdempotencyHit();
        this.metrics.recordIdempotentReplay();
        return existing.response as SyncPushResponse;
      }

      const startedAt = Date.now();
      while (Date.now() - startedAt < SyncService.IDEMPOTENCY_WAIT_MS) {
        await new Promise((resolve) => {
          setTimeout(resolve, SyncService.IDEMPOTENCY_POLL_MS);
        });

        const polled = await this.db.syncPushIdempotency.findOne({
          userId,
          idempotencyKey,
        });
        if (polled?.requestHash !== requestHash) {
          throw new ConflictException(
            "idempotency-key already used with a different sync payload",
          );
        }
        if (polled?.status === "completed" && polled.response) {
          this.metrics.recordIdempotencyHit();
          this.metrics.recordIdempotentReplay();
          return polled.response as SyncPushResponse;
        }
      }

      throw new ConflictException(
        "sync push with this idempotency-key is already in progress",
      );
    }
  }

  private async _finalizeIdempotency(
    userId: string,
    idempotencyKey: string,
    requestHash: string,
    response: SyncPushResponse,
  ): Promise<void> {
    await this.db.syncPushIdempotency.updateOne(
      { userId, idempotencyKey, requestHash },
      {
        $set: {
          status: "completed",
          response,
          updatedAt: new Date(),
        },
      },
    );
  }

  private async _clearIdempotencyInFlight(
    userId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<void> {
    await this.db.syncPushIdempotency.deleteOne({
      userId,
      idempotencyKey,
      requestHash,
      status: "processing",
    });
  }

  // ── Push (client → server) ─────────────────────────────────────────────────
  async push(
    userId: string,
    dto: SyncPushDto,
    idempotencyKey?: string,
    retryCount = 0,
    syncVersion?: number,
  ) {
    const protocolVersion = this._resolveSyncVersion(
      syncVersion ?? dto.syncVersion,
    );
    const startedAt = Date.now();
    const queueDepth =
      (dto.expenses?.length ?? 0) +
      (dto.budgets?.length ?? 0) +
      (dto.goals?.length ?? 0);
    if (retryCount > 0) {
      this.metrics.recordRetry(retryCount);
    }

    const requestHash = idempotencyKey
      ? this._pushRequestHash(userId, dto, protocolVersion)
      : null;
    if (idempotencyKey && requestHash) {
      const replay = await this._resolveIdempotencyReplay(
        userId,
        idempotencyKey,
        requestHash,
      );
      if (replay) {
        this.metrics.recordPushSuccess(Date.now() - startedAt, queueDepth);
        return replay;
      }
    }

    const results = { expenses: 0, budgets: 0, goals: 0 };
    const ack: SyncPushAck = {
      expenses: this._newEntityAck(),
      budgets: this._newEntityAck(),
      goals: this._newEntityAck(),
    };

    try {
      if (dto.expenses?.length) {
        for (const chunk of this._chunk(
          dto.expenses,
          SyncService.PUSH_CHUNK_SIZE,
        )) {
          const ids = chunk.map((expense) => expense.id);
          const existingDocs = await this.db.expenses
            .find(
              { _id: { $in: ids } },
              { projection: { _id: 1, userId: 1, updatedAt: 1 } },
            )
            .toArray();
          const existingById = new Map(
            existingDocs.map((doc) => [doc._id, doc]),
          );

          const operations: AnyBulkWriteOperation<ExpenseDoc>[] = [];
          for (const expense of chunk) {
            const clientUpdatedAt = new Date(expense.updatedAt);
            const existing = existingById.get(expense.id);

            if (existing && existing.userId !== userId) {
              this._recordAck(ack.expenses, expense.id, expense.deleted, false);
              continue;
            }
            if (existing && existing.updatedAt > clientUpdatedAt) {
              this._recordAck(ack.expenses, expense.id, expense.deleted, false);
              continue;
            }

            const now = new Date();
            const updateDoc: Partial<ExpenseDoc> = {
              amount: expense.amount,
              description: expense.description,
              category: expense.category,
              date: new Date(expense.date),
              notes: expense.notes ?? null,
              isIncome: expense.isIncome,
              isRecurring: expense.isRecurring,
              recurringRule: expense.recurringRule ?? null,
              deletedAt: expense.deleted ? now : null,
              updatedAt: now,
              userId,
            };

            if (!expense.isRecurring || expense.recurringRule !== "monthly") {
              updateDoc.recurringDueDay = null;
            } else if (expense.recurringDueDay !== undefined) {
              updateDoc.recurringDueDay = expense.recurringDueDay ?? null;
            }

            const hasExternalReceiptRef =
              !!expense.receiptImageUrl?.trim() ||
              !!expense.receiptStorageKey?.trim();

            if (hasExternalReceiptRef) {
              updateDoc.receiptImageBase64 = null;
            } else if (expense.receiptImageBase64 !== undefined) {
              updateDoc.receiptImageBase64 = expense.receiptImageBase64 ?? null;
            }
            if (expense.receiptImageMimeType !== undefined) {
              updateDoc.receiptImageMimeType =
                expense.receiptImageMimeType ?? null;
            }
            if (expense.receiptImageUrl !== undefined) {
              updateDoc.receiptImageUrl = expense.receiptImageUrl ?? null;
            }
            if (expense.receiptStorageKey !== undefined) {
              updateDoc.receiptStorageKey = expense.receiptStorageKey ?? null;
            }
            if (expense.receiptOcrText !== undefined) {
              updateDoc.receiptOcrText = expense.receiptOcrText ?? null;
            }

            if (existing) {
              operations.push({
                updateOne: {
                  filter: { _id: expense.id, userId },
                  update: { $set: updateDoc },
                },
              });
            } else {
              operations.push({
                updateOne: {
                  filter: { _id: expense.id },
                  update: {
                    $setOnInsert: {
                      _id: expense.id,
                      createdAt: now,
                      recurringParentId: null,
                    },
                    $set: updateDoc,
                  },
                  upsert: true,
                },
              });
            }

            this._recordAck(ack.expenses, expense.id, expense.deleted, true);
            results.expenses += 1;
          }

          if (operations.length > 0) {
            await this.db.expenses.bulkWrite(operations, { ordered: false });
          }
        }
      }

      if (dto.budgets?.length) {
        for (const chunk of this._chunk(
          dto.budgets,
          SyncService.PUSH_CHUNK_SIZE,
        )) {
          const ids = chunk.map((budget) => budget.id);
          const existingDocs = await this.db.budgets
            .find(
              { _id: { $in: ids } },
              { projection: { _id: 1, userId: 1, updatedAt: 1 } },
            )
            .toArray();
          const existingById = new Map(
            existingDocs.map((doc) => [doc._id, doc]),
          );

          const operations: AnyBulkWriteOperation<BudgetDoc>[] = [];
          for (const budget of chunk) {
            const clientUpdatedAt = new Date(budget.updatedAt);
            const existing = existingById.get(budget.id);

            if (existing && existing.userId !== userId) {
              this._recordAck(ack.budgets, budget.id, budget.deleted, false);
              continue;
            }
            if (existing && existing.updatedAt > clientUpdatedAt) {
              this._recordAck(ack.budgets, budget.id, budget.deleted, false);
              continue;
            }
            if (budget.deleted && !existing) {
              this._recordAck(ack.budgets, budget.id, budget.deleted, false);
              continue;
            }

            const now = new Date();
            const updateDoc: Partial<BudgetDoc> = {
              deletedAt: budget.deleted ? now : null,
              updatedAt: now,
              userId,
            };
            if (!budget.deleted) {
              updateDoc.categoryKey = budget.categoryKey!;
              updateDoc.allocatedAmount = budget.allocatedAmount;
              updateDoc.month = budget.month!;
              updateDoc.year = budget.year!;
              updateDoc.carryForward = budget.carryForward!;
            }

            if (existing) {
              operations.push({
                updateOne: {
                  filter: { _id: budget.id, userId },
                  update: { $set: updateDoc },
                },
              });
            } else {
              operations.push({
                updateOne: {
                  filter: { _id: budget.id },
                  update: {
                    $setOnInsert: {
                      _id: budget.id,
                      createdAt: now,
                    },
                    $set: updateDoc,
                  },
                  upsert: true,
                },
              });
            }

            this._recordAck(ack.budgets, budget.id, budget.deleted, true);
            results.budgets += 1;
          }

          if (operations.length > 0) {
            await this.db.budgets.bulkWrite(operations, { ordered: false });
          }
        }
      }

      if (dto.goals?.length) {
        for (const chunk of this._chunk(
          dto.goals,
          SyncService.PUSH_CHUNK_SIZE,
        )) {
          const ids = chunk.map((goal) => goal.id);
          const existingDocs = await this.db.goals
            .find(
              { _id: { $in: ids } },
              { projection: { _id: 1, userId: 1, updatedAt: 1 } },
            )
            .toArray();
          const existingById = new Map(
            existingDocs.map((doc) => [doc._id, doc]),
          );

          const operations: AnyBulkWriteOperation<GoalDoc>[] = [];
          for (const goal of chunk) {
            const clientUpdatedAt = new Date(goal.updatedAt);
            const existing = existingById.get(goal.id);
            if (existing && existing.userId !== userId) {
              this._recordAck(ack.goals, goal.id, goal.deleted, false);
              continue;
            }
            if (existing && existing.updatedAt > clientUpdatedAt) {
              this._recordAck(ack.goals, goal.id, goal.deleted, false);
              continue;
            }

            const now = new Date();
            const updateDoc: Partial<GoalDoc> = {
              title: goal.title ?? "Goal",
              emoji: goal.emoji ?? "🎯",
              targetAmount: goal.targetAmount ?? 0,
              currentAmount: goal.currentAmount ?? 0,
              deadline: goal.deadline ? new Date(goal.deadline) : null,
              colorIndex: goal.colorIndex ?? 0,
              deletedAt: goal.deleted ? now : null,
              updatedAt: now,
              userId,
            };

            if (existing) {
              operations.push({
                updateOne: {
                  filter: { _id: goal.id, userId },
                  update: { $set: updateDoc },
                },
              });
            } else {
              operations.push({
                updateOne: {
                  filter: { _id: goal.id },
                  update: {
                    $setOnInsert: {
                      _id: goal.id,
                      createdAt: now,
                    },
                    $set: updateDoc,
                  },
                  upsert: true,
                },
              });
            }

            this._recordAck(ack.goals, goal.id, goal.deleted, true);
            results.goals += 1;
          }

          if (operations.length > 0) {
            await this.db.goals.bulkWrite(operations, { ordered: false });
          }
        }
      }

      const response: SyncPushResponse = {
        syncVersion: protocolVersion,
        synced: results,
        ack,
        timestamp: new Date().toISOString(),
      };

      if (idempotencyKey && requestHash) {
        await this._finalizeIdempotency(
          userId,
          idempotencyKey,
          requestHash,
          response,
        );
      }

      this._invalidatePullCacheForUser(userId);

      this.metrics.recordPushSuccess(Date.now() - startedAt, queueDepth);
      return response;
    } catch (error) {
      if (idempotencyKey && requestHash) {
        await this._clearIdempotencyInFlight(
          userId,
          idempotencyKey,
          requestHash,
        );
      }
      this.metrics.recordPushError(Date.now() - startedAt);
      throw error;
    }
  }

  async getTelemetry() {
    const snapshot = this.metrics.snapshot() as Record<string, unknown>;
    const expiredBacklog = await this.db.syncPushIdempotency.countDocuments({
      expiresAt: { $lte: new Date() },
    });

    const anomalies = this.detectTelemetryAnomalies(snapshot, expiredBacklog);
    if (anomalies.length > 0) {
      this.logger.warn(
        `Sync telemetry anomalies detected: ${JSON.stringify(
          anomalies.map((a) => ({
            code: a.code,
            severity: a.severity,
            observed: a.observed,
            threshold: a.threshold,
          })),
        )}`,
      );
    }

    return {
      ...snapshot,
      idempotency: {
        ttlMs: SyncService.IDEMPOTENCY_TTL_MS,
        expiredBacklog,
      },
      anomalies,
    };
  }

  private asNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  private detectTelemetryAnomalies(
    snapshot: Record<string, unknown>,
    expiredBacklog: number,
  ): TelemetryAnomaly[] {
    const counters =
      (snapshot.counters as Record<string, unknown> | undefined) ?? {};
    const staleness =
      (snapshot.staleness as Record<string, unknown> | undefined) ?? {};

    const pushTotal = this.asNumber(counters.pushTotal);
    const pushErrors = this.asNumber(counters.pushErrors);
    const pullTotal = this.asNumber(counters.pullTotal);
    const pullErrors = this.asNumber(counters.pullErrors);
    const retries = this.asNumber(counters.retries);
    const pullStalenessP95Ms = this.asNumber(staleness.pullStalenessP95Ms);

    const anomalies: TelemetryAnomaly[] = [];

    if (pushTotal >= SyncService.ANOMALY_MIN_SAMPLE_SIZE) {
      const pushErrorRate = pushErrors / pushTotal;
      if (pushErrorRate >= SyncService.ANOMALY_PUSH_ERROR_RATE) {
        anomalies.push({
          code: "sync_push_error_rate_high",
          severity: "critical",
          message: "Push error rate is above threshold",
          observed: Number(pushErrorRate.toFixed(4)),
          threshold: SyncService.ANOMALY_PUSH_ERROR_RATE,
          unit: "ratio",
        });
      }
    }

    if (pullTotal >= SyncService.ANOMALY_MIN_SAMPLE_SIZE) {
      const pullErrorRate = pullErrors / pullTotal;
      if (pullErrorRate >= SyncService.ANOMALY_PULL_ERROR_RATE) {
        anomalies.push({
          code: "sync_pull_error_rate_high",
          severity: "critical",
          message: "Pull error rate is above threshold",
          observed: Number(pullErrorRate.toFixed(4)),
          threshold: SyncService.ANOMALY_PULL_ERROR_RATE,
          unit: "ratio",
        });
      }
    }

    const totalSyncOps = pushTotal + pullTotal;
    if (totalSyncOps >= SyncService.ANOMALY_MIN_SAMPLE_SIZE) {
      const retryRate = retries / totalSyncOps;
      if (retryRate >= SyncService.ANOMALY_RETRY_RATE) {
        anomalies.push({
          code: "sync_retry_rate_high",
          severity: "warning",
          message: "Retry rate is above threshold",
          observed: Number(retryRate.toFixed(4)),
          threshold: SyncService.ANOMALY_RETRY_RATE,
          unit: "ratio",
        });
      }
    }

    if (pullStalenessP95Ms >= SyncService.ANOMALY_PULL_STALENESS_P95_MS) {
      anomalies.push({
        code: "sync_pull_staleness_high",
        severity: "warning",
        message: "Pull staleness p95 is above threshold",
        observed: pullStalenessP95Ms,
        threshold: SyncService.ANOMALY_PULL_STALENESS_P95_MS,
        unit: "ms",
      });
    }

    if (expiredBacklog >= SyncService.ANOMALY_IDEMPOTENCY_BACKLOG) {
      anomalies.push({
        code: "sync_idempotency_backlog_high",
        severity: "critical",
        message: "Expired idempotency backlog is above threshold",
        observed: expiredBacklog,
        threshold: SyncService.ANOMALY_IDEMPOTENCY_BACKLOG,
        unit: "count",
      });
    }

    return anomalies;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredIdempotencyRecords(): Promise<void> {
    try {
      const result = await this.db.syncPushIdempotency.deleteMany({
        expiresAt: { $lte: new Date() },
      });
      const purged = result.deletedCount ?? 0;
      if (purged > 0) {
        this.metrics.recordIdempotencyPurge(purged);
        this.logger.warn(`Purged ${purged} expired sync idempotency records`);
      }
    } catch (error) {
      this.logger.error(
        "Failed to purge expired sync idempotency records",
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  // ── Pull (server → client) ─────────────────────────────────────────────────
  async pull(userId: string, since?: string, syncVersion?: number) {
    const protocolVersion = this._resolveSyncVersion(syncVersion);
    const startedAt = Date.now();
    const parsedSince = since ? new Date(since) : null;
    const hasValidSince = !!(
      parsedSince && !Number.isNaN(parsedSince.getTime())
    );
    const sinceDate = hasValidSince ? parsedSince! : new Date(0);
    const cacheKey = this._pullCacheKey(userId, sinceDate, protocolVersion);

    if (hasValidSince) {
      const watermark = this._getPullWatermark(userId);
      if (watermark && sinceDate.getTime() >= watermark.latestMutationAtMs) {
        const stalenessMs = Date.now() - sinceDate.getTime();
        const unchangedResponse = this._unchangedPullResponse(protocolVersion);
        this.metrics.recordPullSuccess(
          Date.now() - startedAt,
          stalenessMs,
          true,
          userId,
        );
        return unchangedResponse;
      }
    }

    const cached = this._getPullCache(cacheKey);
    if (cached) {
      const stalenessMs = hasValidSince
        ? Date.now() - sinceDate.getTime()
        : undefined;
      this.metrics.recordPullSuccess(
        Date.now() - startedAt,
        stalenessMs,
        cached.unchanged === true,
        userId,
      );
      return cached;
    }

    const inFlight = this.inFlightPulls.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = this._pullFresh(
      userId,
      sinceDate,
      hasValidSince,
      protocolVersion,
    );
    this.inFlightPulls.set(cacheKey, request);
    try {
      const response = await request;
      this._setPullCache(cacheKey, response);
      return response;
    } finally {
      this.inFlightPulls.delete(cacheKey);
    }
  }

  private async _pullFresh(
    userId: string,
    sinceDate: Date,
    hasValidSince: boolean,
    syncVersion: number,
  ): Promise<SyncPullResponse> {
    const startedAt = Date.now();

    try {
      const userProjection = {
        _id: 1,
        name: 1,
        email: 1,
        avatarUrl: 1,
        currency: 1,
        monthlyBudget: 1,
        emailVerified: 1,
        updatedAt: 1,
      } as const;

      const [latestExpense, latestBudget, latestGoal, user] = await Promise.all(
        [
          hasValidSince
            ? this.db.expenses
                .find({ userId }, { projection: { _id: 0, updatedAt: 1 } })
                .sort({ updatedAt: -1 })
                .limit(1)
                .next()
            : Promise.resolve(null),
          hasValidSince
            ? this.db.budgets
                .find({ userId }, { projection: { _id: 0, updatedAt: 1 } })
                .sort({ updatedAt: -1 })
                .limit(1)
                .next()
            : Promise.resolve(null),
          hasValidSince
            ? this.db.goals
                .find({ userId }, { projection: { _id: 0, updatedAt: 1 } })
                .sort({ updatedAt: -1 })
                .limit(1)
                .next()
            : Promise.resolve(null),
          this.db.users.findOne(
            { _id: userId },
            { projection: userProjection },
          ) as Promise<SyncUserProjection | null>,
        ],
      );

      if (hasValidSince) {
        const latestMutationAt = this._maxDate([
          latestExpense?.updatedAt,
          latestBudget?.updatedAt,
          latestGoal?.updatedAt,
          user?.updatedAt,
        ]);

        this._setPullWatermark(userId, latestMutationAt);

        if (!latestMutationAt || latestMutationAt <= sinceDate) {
          const stalenessMs = Date.now() - sinceDate.getTime();
          this.metrics.recordPullSuccess(
            Date.now() - startedAt,
            stalenessMs,
            true,
            userId,
          );
          return this._unchangedPullResponse(syncVersion);
        }
      }

      const [expenses, budgets, goals] = await Promise.all([
        this.db.expenses
          .find({ userId, updatedAt: { $gt: sinceDate } })
          .sort({ updatedAt: 1 })
          .toArray(),
        this.db.budgets
          .find({ userId, updatedAt: { $gt: sinceDate } })
          .sort({ updatedAt: 1 })
          .toArray(),
        this.db.goals
          .find({ userId, updatedAt: { $gt: sinceDate } })
          .sort({ updatedAt: 1 })
          .toArray(),
      ]);

      const stalenessMs = hasValidSince
        ? Date.now() - sinceDate.getTime()
        : undefined;

      const latestExpenseUpdatedAt =
        expenses.length > 0 ? expenses[expenses.length - 1].updatedAt : null;
      const latestBudgetUpdatedAt =
        budgets.length > 0 ? budgets[budgets.length - 1].updatedAt : null;
      const latestGoalUpdatedAt =
        goals.length > 0 ? goals[goals.length - 1].updatedAt : null;

      const latestMutationAt = this._maxDate([
        latestExpenseUpdatedAt,
        latestBudgetUpdatedAt,
        latestGoalUpdatedAt,
        user?.updatedAt,
      ]);
      this._setPullWatermark(userId, latestMutationAt);

      const userChangedSince =
        !hasValidSince ||
        (user?.updatedAt instanceof Date && user.updatedAt > sinceDate);
      const serializedUser = userChangedSince
        ? this._serializeUser(user)
        : null;
      const hasDelta =
        expenses.length > 0 ||
        budgets.length > 0 ||
        goals.length > 0 ||
        serializedUser !== null;

      if (!hasDelta) {
        this.metrics.recordPullSuccess(
          Date.now() - startedAt,
          stalenessMs,
          true,
          userId,
        );
        return this._unchangedPullResponse(syncVersion);
      }

      this.metrics.recordPullSuccess(
        Date.now() - startedAt,
        stalenessMs,
        false,
        userId,
      );

      return {
        syncVersion,
        expenses: expenses.map((e) => ({
          ...e,
          id: e._id,
          deleted: !!e.deletedAt,
        })),
        budgets: budgets.map((b) => ({
          ...b,
          id: b._id,
          deleted: !!b.deletedAt,
        })),
        goals: goals.map((g) => ({
          ...g,
          id: g._id,
          deleted: !!g.deletedAt,
        })),
        user: serializedUser,
        serverTime: new Date().toISOString(),
        suggestedPullDelayMs: SyncService.PULL_SUGGESTED_DELAY_ACTIVE_MS,
      };
    } catch (error) {
      this.metrics.recordPullError(Date.now() - startedAt);
      throw error;
    }
  }
}
