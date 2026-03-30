import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DatabaseService } from "../../database/database.service";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { ExpenseQueryDto } from "./dto/expense-query.dto";
import { ExpenseDoc } from "../../database/database.types";

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(private db: DatabaseService) {}

  async findAll(userId: string, query: ExpenseQueryDto) {
    const filter: Record<string, any> = { userId, deletedAt: null };

    if (query.category) filter.category = query.category;
    if (query.search)
      filter.description = {
        $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    if (query.from || query.to) {
      filter.date = {
        ...(query.from && { $gte: new Date(query.from) }),
        ...(query.to && { $lte: new Date(query.to) }),
      };
    }
    if (query.cursor) filter._id = { $lt: query.cursor };

    const take = (query.take ?? 20) + 1;
    const sortField = query.sortBy ?? "date";
    const sortDir = query.order === "asc" ? 1 : -1;

    const items = await this.db.expenses
      .find(filter)
      .sort({ [sortField]: sortDir, _id: -1 })
      .limit(take)
      .toArray();

    const hasMore = items.length === take;
    const data = hasMore ? items.slice(0, -1) : items;
    // Only run countDocuments on the first page (no cursor) to avoid
    // an extra full-scan on every paginated scroll request.
    const total = query.cursor
      ? undefined
      : await this.db.expenses.countDocuments(filter);

    return {
      data: data.map(this._toClient),
      nextCursor: hasMore ? data[data.length - 1]._id : null,
      hasMore,
      total,
    };
  }

  async findOne(id: string, userId: string) {
    const expense = await this.db.expenses.findOne({
      _id: id,
      deletedAt: null,
    });
    if (!expense) throw new NotFoundException("Expense not found");
    if (expense.userId !== userId) throw new ForbiddenException();
    return this._toClient(expense);
  }

  async create(userId: string, dto: CreateExpenseDto) {
    const now = new Date();
    const doc: ExpenseDoc = {
      _id: dto.id ?? randomUUID(), // honour client UUID to avoid sync duplicates
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...dto,
      date: new Date(dto.date),
      isIncome: dto.isIncome ?? false,
      isRecurring: dto.isRecurring ?? false,
      recurringRule: dto.recurringRule ?? null,
      recurringParentId: null,
      notes: dto.notes ?? null,
      userId,
    };
    await this.db.expenses.insertOne(doc);
    return this._toClient(doc);
  }

  async update(id: string, userId: string, dto: Partial<CreateExpenseDto>) {
    await this.findOne(id, userId);
    const set: Record<string, any> = { ...dto, updatedAt: new Date() };
    if (dto.date) set.date = new Date(dto.date);
    await this.db.expenses.updateOne({ _id: id }, { $set: set });
    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);
    await this.db.expenses.updateOne(
      { _id: id },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } },
    );
  }

  // ── Analytics ──────────────────────────────────────────────────────────────
  async getSummary(userId: string, month: number, year: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    const allRecords = await this.db.expenses
      .find({ userId, deletedAt: null, date: { $gte: start, $lte: end } })
      .toArray();

    const expenses = allRecords.filter((e) => !e.isIncome);
    const incomeRecords = allRecords.filter((e) => e.isIncome);

    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const totalIncome = incomeRecords.reduce((s, e) => s + e.amount, 0);

    const byCategory: Record<string, number> = {};
    for (const e of expenses) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
    }

    const today = new Date();
    const last7: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(today);
      day.setDate(today.getDate() - i);
      const dayStart = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
      );
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59);
      const sum = expenses
        .filter((e) => e.date >= dayStart && e.date <= dayEnd)
        .reduce((s, e) => s + e.amount, 0);
      last7.push(sum);
    }

    return {
      total: totalExpenses,
      totalIncome,
      net: totalIncome - totalExpenses,
      byCategory,
      last7DaysSpending: last7,
      count: expenses.length,
      incomeCount: incomeRecords.length,
    };
  }

  // ── Recurring Expense Cron ─────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async generateRecurringExpenses(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const templates = await this.db.expenses
      .find({ isRecurring: true, recurringParentId: null, deletedAt: null })
      .toArray();

    if (templates.length === 0) return;
    this.logger.log(`Recurring cron: checking ${templates.length} template(s)`);

    for (const template of templates) {
      if (!template.recurringRule) continue;

      const lastInstance = await this.db.expenses
        .find({ recurringParentId: template._id, deletedAt: null })
        .sort({ date: -1 })
        .limit(1)
        .next();

      const baseDate = new Date(lastInstance?.date ?? template.date);
      baseDate.setHours(0, 0, 0, 0);

      const datesToGenerate: Date[] = [];
      let nextDate = this._nextOccurrence(baseDate, template.recurringRule);
      let safety = 0;
      while (nextDate <= today && safety < 365) {
        datesToGenerate.push(new Date(nextDate));
        nextDate = this._nextOccurrence(nextDate, template.recurringRule);
        safety++;
      }

      if (datesToGenerate.length === 0) continue;

      const existingInstances = await this.db.expenses
        .find({
          recurringParentId: template._id,
          date: {
            $gte: datesToGenerate[0],
            $lte: datesToGenerate[datesToGenerate.length - 1],
          },
          deletedAt: null,
        })
        .project({ date: 1 })
        .toArray();

      const existingKeys = new Set(
        existingInstances.map(
          (e) =>
            `${e.date.getFullYear()}-${e.date.getMonth()}-${e.date.getDate()}`,
        ),
      );

      const now = new Date();
      const newDocs: ExpenseDoc[] = datesToGenerate
        .filter(
          (d) =>
            !existingKeys.has(
              `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
            ),
        )
        .map((d) => ({
          _id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          amount: template.amount,
          description: template.description,
          category: template.category,
          notes: template.notes ?? null,
          isIncome: template.isIncome,
          isRecurring: false,
          recurringRule: null,
          recurringParentId: template._id,
          date: d,
          userId: template.userId,
        }));

      if (newDocs.length > 0) {
        await this.db.expenses.insertMany(newDocs);
        this.logger.log(
          `Recurring: created ${newDocs.length} instance(s) for template ${template._id}`,
        );
      }
    }
  }

  private _nextOccurrence(from: Date, rule: string): Date {
    const next = new Date(from);
    switch (rule) {
      case "daily":
        next.setDate(next.getDate() + 1);
        break;
      case "weekly":
        next.setDate(next.getDate() + 7);
        break;
      case "monthly":
        next.setMonth(next.getMonth() + 1);
        break;
      case "yearly":
        next.setFullYear(next.getFullYear() + 1);
        break;
    }
    return next;
  }

  private _toClient(e: ExpenseDoc) {
    return { ...e, id: e._id };
  }
}
