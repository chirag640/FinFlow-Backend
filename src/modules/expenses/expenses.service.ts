import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { randomUUID } from "crypto";
import { DatabaseService } from "../../database/database.service";
import { ExpenseDoc } from "../../database/database.types";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { ExpenseQueryDto } from "./dto/expense-query.dto";

type ExpenseFilter = {
  userId: string;
  deletedAt: null;
  category?: string;
  description?: { $regex: string; $options: "i" };
  date?: { $gte?: Date; $lte?: Date };
  _id?: { $lt: string };
};

type ExpenseUpdateSet = Partial<Omit<CreateExpenseDto, "date">> & {
  recurringRule?: string | null;
  recurringDueDay?: number | null;
  receiptImageBase64?: string | null;
  receiptImageUrl?: string | null;
  receiptStorageKey?: string | null;
  updatedAt: Date;
  date?: Date;
};

const EXPENSE_SORT_FIELDS = ["date", "amount", "createdAt"] as const;
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(private db: DatabaseService) {}

  async findAll(userId: string, query: ExpenseQueryDto) {
    const filter: ExpenseFilter = { userId, deletedAt: null };

    if (typeof query.category === "string" && query.category.length > 0) {
      filter.category = query.category;
    }

    if (typeof query.search === "string" && query.search.length > 0)
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
    if (typeof query.cursor === "string" && UUID_V4_REGEX.test(query.cursor)) {
      filter._id = { $lt: query.cursor };
    }

    const take = (query.take ?? 20) + 1;
    const sortField = EXPENSE_SORT_FIELDS.includes(
      query.sortBy as (typeof EXPENSE_SORT_FIELDS)[number],
    )
      ? (query.sortBy as (typeof EXPENSE_SORT_FIELDS)[number])
      : "date";
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
    const countFilter: ExpenseFilter = { ...filter };
    delete countFilter._id;
    const total = filter._id
      ? undefined
      : await this.db.expenses.countDocuments(countFilter);

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
    const recurringRule = dto.isRecurring ? (dto.recurringRule ?? null) : null;
    const recurringDueDay =
      dto.isRecurring && recurringRule === "monthly"
        ? (dto.recurringDueDay ?? null)
        : null;
    const hasExternalReceiptRef =
      !!dto.receiptImageUrl?.trim() || !!dto.receiptStorageKey?.trim();
    const doc: ExpenseDoc = {
      _id: dto.id ?? randomUUID(), // honour client UUID to avoid sync duplicates
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...dto,
      date: new Date(dto.date),
      isIncome: dto.isIncome ?? false,
      isRecurring: dto.isRecurring ?? false,
      recurringRule,
      recurringDueDay,
      recurringParentId: null,
      notes: dto.notes ?? null,
      receiptImageBase64: hasExternalReceiptRef
        ? null
        : (dto.receiptImageBase64 ?? null),
      receiptImageMimeType: dto.receiptImageMimeType ?? null,
      receiptImageUrl: dto.receiptImageUrl ?? null,
      receiptStorageKey: dto.receiptStorageKey ?? null,
      receiptOcrText: dto.receiptOcrText ?? null,
      userId,
    };
    await this.db.expenses.insertOne(doc);
    return this._toClient(doc);
  }

  async update(id: string, userId: string, dto: Partial<CreateExpenseDto>) {
    await this.findOne(id, userId);
    const { date, ...rest } = dto;
    const set: ExpenseUpdateSet = { ...rest, updatedAt: new Date() };
    if (date) set.date = new Date(date);

    const hasExternalReceiptRef =
      !!dto.receiptImageUrl?.trim() || !!dto.receiptStorageKey?.trim();
    if (hasExternalReceiptRef) {
      set.receiptImageBase64 = null;
    }

    if (dto.isRecurring === false) {
      set.recurringRule = null;
      set.recurringDueDay = null;
    } else if (dto.recurringRule && dto.recurringRule !== "monthly") {
      set.recurringDueDay = null;
    }

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
      let nextDate = this._nextOccurrence(
        baseDate,
        template.recurringRule,
        template.recurringDueDay,
      );
      let safety = 0;
      while (nextDate <= today && safety < 365) {
        datesToGenerate.push(new Date(nextDate));
        nextDate = this._nextOccurrence(
          nextDate,
          template.recurringRule,
          template.recurringDueDay,
        );
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

  private _nextOccurrence(
    from: Date,
    rule: string,
    recurringDueDay?: number | null,
  ): Date {
    const next = new Date(from);
    switch (rule) {
      case "daily":
        next.setDate(next.getDate() + 1);
        break;
      case "weekly":
        next.setDate(next.getDate() + 7);
        break;
      case "monthly":
        if (typeof recurringDueDay === "number") {
          return this._nextMonthlyOccurrence(from, recurringDueDay);
        }
        next.setMonth(next.getMonth() + 1);
        break;
      case "yearly":
        next.setFullYear(next.getFullYear() + 1);
        break;
    }
    return next;
  }

  private _nextMonthlyOccurrence(from: Date, recurringDueDay: number): Date {
    const targetMonth = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    const daysInMonth = new Date(
      targetMonth.getFullYear(),
      targetMonth.getMonth() + 1,
      0,
    ).getDate();
    const dueDay = Math.min(Math.max(recurringDueDay, 1), daysInMonth);
    return new Date(targetMonth.getFullYear(), targetMonth.getMonth(), dueDay);
  }

  private _toClient(e: ExpenseDoc) {
    return { ...e, id: e._id };
  }
}
