import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { DatabaseService } from "../../database/database.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { ExpenseDoc, BudgetDoc } from "../../database/database.types";
import { SyncPushDto } from "./dto/sync.dto";

@Injectable()
export class SyncService {
  constructor(
    private db: DatabaseService,
    private encryption: EncryptionService,
  ) {}

  // ── Push (client → server) ─────────────────────────────────────────────────
  async push(userId: string, dto: SyncPushDto) {
    const results = { expenses: 0, budgets: 0 };

    if (dto.expenses?.length) {
      for (const e of dto.expenses) {
        const clientUpdatedAt = new Date(e.updatedAt);
        const existing = await this.db.expenses.findOne(
          { _id: e.id },
          { projection: { updatedAt: 1, userId: 1 } },
        );
        // IDOR guard: never overwrite a record that belongs to a different user
        if (existing && existing.userId !== userId) continue;
        if (existing && existing.updatedAt > clientUpdatedAt) continue;

        const doc: Partial<ExpenseDoc> = {
          amount: e.amount,
          description: e.description,
          category: e.category,
          date: new Date(e.date),
          notes: e.notes ?? null,
          isIncome: e.isIncome,
          isRecurring: e.isRecurring,
          recurringRule: e.recurringRule ?? null,
          deletedAt: e.deleted ? new Date() : null,
          updatedAt: new Date(),
          userId,
        };

        if (existing) {
          await this.db.expenses.updateOne({ _id: e.id }, { $set: doc });
        } else {
          const now = new Date();
          await this.db.expenses.insertOne({
            _id: e.id ?? randomUUID(),
            createdAt: now,
            recurringParentId: null,
            ...doc,
          } as ExpenseDoc);
        }
        results.expenses++;
      }
    }

    if (dto.budgets?.length) {
      for (const b of dto.budgets) {
        const clientUpdatedAt = new Date(b.updatedAt);
        const existing = await this.db.budgets.findOne(
          { _id: b.id },
          { projection: { updatedAt: 1, userId: 1 } },
        );
        // IDOR guard: never overwrite a record that belongs to a different user
        if (existing && existing.userId !== userId) continue;
        if (existing && existing.updatedAt > clientUpdatedAt) continue;

        const doc: Partial<BudgetDoc> = {
          categoryKey: b.categoryKey,
          allocatedAmount: b.allocatedAmount,
          month: b.month,
          year: b.year,
          carryForward: b.carryForward,
          deletedAt: b.deleted ? new Date() : null,
          updatedAt: new Date(),
          userId,
        };

        if (existing) {
          await this.db.budgets.updateOne({ _id: b.id }, { $set: doc });
        } else {
          const now = new Date();
          await this.db.budgets.insertOne({
            _id: b.id ?? randomUUID(),
            createdAt: now,
            ...doc,
          } as BudgetDoc);
        }
        results.budgets++;
      }
    }

    return { synced: results, timestamp: new Date().toISOString() };
  }

  // ── Pull (server → client) ─────────────────────────────────────────────────
  async pull(userId: string, since?: string) {
    const sinceDate = since ? new Date(since) : new Date(0);

    const [expenses, budgets, user] = await Promise.all([
      this.db.expenses
        .find({ userId, updatedAt: { $gte: sinceDate } })
        .sort({ updatedAt: 1 })
        .toArray(),
      this.db.budgets
        .find({ userId, updatedAt: { $gte: sinceDate } })
        .sort({ updatedAt: 1 })
        .toArray(),
      this.db.users.findOne(
        { _id: userId },
        {
          projection: {
            _id: 1,
            name: 1,
            email: 1,
            avatarUrl: 1,
            currency: 1,
            monthlyBudget: 1,
            emailVerified: 1,
            // pinHash intentionally excluded — the client stores the PIN locally;
            // sending the hash over the network is an unnecessary data exposure.
          },
        },
      ),
    ]);

    return {
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
      user: user
        ? {
            id: user._id,
            name: this.encryption.decrypt(user.name),
            email: user.email,
            avatarUrl: user.avatarUrl,
            currency: user.currency,
            monthlyBudget: user.monthlyBudget,
            emailVerified: user.emailVerified,
          }
        : null,
      serverTime: new Date().toISOString(),
    };
  }
}
