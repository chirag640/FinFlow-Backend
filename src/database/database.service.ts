import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Collection, Db, MongoClient, MongoClientOptions } from "mongodb";
import { randomUUID } from "crypto";
import {
  UserDoc,
  RefreshTokenDoc,
  ExpenseDoc,
  BudgetDoc,
  GroupDoc,
  GroupMemberDoc,
  GroupExpenseDoc,
  GoalDoc,
  InvestmentDoc,
} from "./database.types";

export { randomUUID };

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private client!: MongoClient;
  private db!: Db;

  async onModuleInit() {
    const url =
      process.env.DATABASE_URL ?? "mongodb://localhost:27017/finflow_db";

    // Strip DB name from URL for MongoClient, then select it
    const opts: MongoClientOptions = {};
    this.client = new MongoClient(url, opts);
    await this.client.connect();

    // Extract DB name from URL (everything after last /)
    const dbName = url.split("/").pop()?.split("?")[0] ?? "finflow_db";
    this.db = this.client.db(dbName);

    this.logger.log(`Connected to MongoDB: ${dbName}`);
    await this._ensureIndexes();
  }

  async onModuleDestroy() {
    await this.client.close();
    this.logger.log("MongoDB connection closed");
  }

  // ── Collection accessors ────────────────────────────────────────────────────
  get users(): Collection<UserDoc> {
    return this.db.collection<UserDoc>("User");
  }
  get refreshTokens(): Collection<RefreshTokenDoc> {
    return this.db.collection<RefreshTokenDoc>("RefreshToken");
  }
  get expenses(): Collection<ExpenseDoc> {
    return this.db.collection<ExpenseDoc>("Expense");
  }
  get budgets(): Collection<BudgetDoc> {
    return this.db.collection<BudgetDoc>("Budget");
  }
  get goals(): Collection<GoalDoc> {
    return this.db.collection<GoalDoc>("Goal");
  }
  get groups(): Collection<GroupDoc> {
    return this.db.collection<GroupDoc>("Group");
  }
  get groupMembers(): Collection<GroupMemberDoc> {
    return this.db.collection<GroupMemberDoc>("GroupMember");
  }
  get groupExpenses(): Collection<GroupExpenseDoc> {
    return this.db.collection<GroupExpenseDoc>("GroupExpense");
  }
  get investments(): Collection<InvestmentDoc> {
    return this.db.collection<InvestmentDoc>("Investment");
  }

  // ── Index bootstrap ─────────────────────────────────────────────────────────
  private async _ensureIndexes() {
    // Wrap every createIndex call — if an equivalent index already exists with
    // a different name (e.g. Prisma-generated names), skip gracefully.
    const safe = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e: unknown) {
        const mongoErr = e as { code?: number; message?: string };
        // 85 = IndexKeySpecsConflict (same keys, different name — already covered)
        // 86 = IndexOptionsConflict
        if (mongoErr.code === 85 || mongoErr.code === 86) {
          this.logger.warn(
            `Index skipped (already exists): ${mongoErr.message}`,
          );
        } else {
          throw e;
        }
      }
    };

    await safe(() => this.users.createIndex({ email: 1 }, { unique: true }));
    await safe(() =>
      this.users.createIndex({ username: 1 }, { unique: true, sparse: true }),
    );
    await safe(() => this.users.createIndex({ deletedAt: 1 }));

    await safe(() =>
      this.refreshTokens.createIndex({ token: 1 }, { unique: true }),
    );
    await safe(() => this.refreshTokens.createIndex({ userId: 1 }));
    await safe(() =>
      this.refreshTokens.createIndex({ userId: 1, createdAt: -1 }),
    );
    await safe(() =>
      this.refreshTokens.createIndex({ userId: 1, lastUsedAt: -1 }),
    );
    await safe(() =>
      this.refreshTokens.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 },
      ),
    );

    await safe(() => this.expenses.createIndex({ userId: 1 }));
    await safe(() => this.expenses.createIndex({ date: 1 }));
    await safe(() => this.expenses.createIndex({ category: 1 }));
    await safe(() => this.expenses.createIndex({ deletedAt: 1 }));
    await safe(() => this.expenses.createIndex({ userId: 1, date: 1 }));

    await safe(() => this.budgets.createIndex({ userId: 1 }));
    await safe(() =>
      this.budgets.createIndex(
        { userId: 1, categoryKey: 1, month: 1, year: 1 },
        { unique: true },
      ),
    );

    await safe(() => this.goals.createIndex({ userId: 1 }));
    await safe(() => this.goals.createIndex({ userId: 1, updatedAt: 1 }));
    await safe(() => this.goals.createIndex({ deletedAt: 1 }));

    await safe(() => this.groups.createIndex({ ownerId: 1 }));
    await safe(() => this.groups.createIndex({ deletedAt: 1 }));

    await safe(() => this.groupMembers.createIndex({ groupId: 1 }));
    await safe(() => this.groupMembers.createIndex({ userId: 1 }));

    await safe(() => this.groupExpenses.createIndex({ groupId: 1 }));
    await safe(() => this.groupExpenses.createIndex({ deletedAt: 1 }));

    await safe(() => this.investments.createIndex({ userId: 1 }));
    await safe(() => this.investments.createIndex({ userId: 1, type: 1 }));
    await safe(() => this.investments.createIndex({ deletedAt: 1 }));

    this.logger.log("MongoDB indexes ensured");
  }
}
