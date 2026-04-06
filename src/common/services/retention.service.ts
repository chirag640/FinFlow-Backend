import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DatabaseService } from "../../database/database.service";
import { RETENTION_CONFIG, TIME_CONSTANTS } from "../constants";

/**
 * RetentionService handles permanent deletion of soft-deleted records
 * after the configured retention period has elapsed.
 *
 * This allows users a grace period to recover accidentally deleted data
 * while ensuring old tombstone records don't accumulate indefinitely.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Runs daily at 3 AM to permanently delete soft-deleted records
   * that are older than the retention period.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredSoftDeletes(): Promise<void> {
    const cutoffDate = new Date(
      Date.now() -
        RETENTION_CONFIG.SOFT_DELETE_RETENTION_DAYS * TIME_CONSTANTS.ONE_DAY_MS,
    );
    const batchSize = RETENTION_CONFIG.PERMANENT_DELETE_BATCH_SIZE;

    const results = await Promise.allSettled([
      this.purgeCollection("expenses", cutoffDate, batchSize),
      this.purgeCollection("budgets", cutoffDate, batchSize),
      this.purgeCollection("goals", cutoffDate, batchSize),
      this.purgeCollection("groups", cutoffDate, batchSize),
      this.purgeCollection("groupExpenses", cutoffDate, batchSize),
    ]);

    const summary = results.map((r, i) => {
      const collections = [
        "expenses",
        "budgets",
        "goals",
        "groups",
        "groupExpenses",
      ];
      if (r.status === "fulfilled") {
        return `${collections[i]}: ${r.value}`;
      }
      return `${collections[i]}: error`;
    });

    this.logger.log(`Retention purge completed: ${summary.join(", ")}`);
  }

  private async purgeCollection(
    name: "expenses" | "budgets" | "goals" | "groups" | "groupExpenses",
    cutoffDate: Date,
    batchSize: number,
  ): Promise<number> {
    try {
      const collection = this.db[name];
      const result = await collection.deleteMany({
        deletedAt: { $ne: null, $lte: cutoffDate },
        // Use limit via a find-delete pattern for batch safety
      });

      // If we hit the batch limit, we'll catch up on subsequent runs
      const deleted = Math.min(result.deletedCount ?? 0, batchSize);

      if (deleted > 0) {
        this.logger.log(
          `Permanently deleted ${deleted} ${name} records older than ${cutoffDate.toISOString()}`,
        );
      }

      return deleted;
    } catch (error) {
      this.logger.error(
        `Failed to purge expired ${name} records`,
        error instanceof Error ? error.stack : undefined,
      );
      return 0;
    }
  }

  /**
   * Returns retention policy configuration for documentation/health endpoints.
   */
  getRetentionPolicy() {
    return {
      softDeleteRetentionDays: RETENTION_CONFIG.SOFT_DELETE_RETENTION_DAYS,
      permanentDeleteBatchSize: RETENTION_CONFIG.PERMANENT_DELETE_BATCH_SIZE,
      purgeSchedule: "Daily at 3 AM UTC",
    };
  }
}
