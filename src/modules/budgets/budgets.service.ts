import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { DatabaseService } from "../../database/database.service";
import { BudgetDoc } from "../../database/database.types";
import { CreateBudgetDto } from "./dto/create-budget.dto";

@Injectable()
export class BudgetsService {
  // v2 — client-uuid upsert supported
  constructor(private db: DatabaseService) {}

  async findByMonth(userId: string, month: number, year: number) {
    const budgets = await this.db.budgets
      .find({ userId, month, year, deletedAt: null })
      .toArray();

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    // Group spending per category using MongoDB aggregation
    const spendingAgg = await this.db.expenses
      .aggregate<{
        _id: string;
        total: number;
      }>([
        {
          $match: {
            userId,
            deletedAt: null,
            date: { $gte: start, $lte: end },
            isIncome: false,
          },
        },
        { $group: { _id: "$category", total: { $sum: "$amount" } } },
      ])
      .toArray();

    const spendingMap: Record<string, number> = {};
    for (const row of spendingAgg) spendingMap[row._id] = row.total;

    return budgets.map((b) => {
      const spent = spendingMap[b.categoryKey] ?? 0;
      const pct =
        b.allocatedAmount > 0
          ? Math.min(100, Math.round((spent / b.allocatedAmount) * 100))
          : 0;
      return {
        ...b,
        id: b._id,
        spent,
        remaining: b.allocatedAmount - spent,
        pct,
      };
    });
  }

  async upsert(userId: string, dto: CreateBudgetDto) {
    const filter = {
      userId,
      categoryKey: dto.categoryKey,
      month: dto.month,
      year: dto.year,
    };
    const existing = await this.db.budgets.findOne(filter);

    if (existing) {
      await this.db.budgets.updateOne(
        { _id: existing._id },
        {
          $set: {
            allocatedAmount: dto.allocatedAmount,
            carryForward: dto.carryForward ?? false,
            deletedAt: null,
            updatedAt: new Date(),
          },
        },
      );
      return this.db.budgets.findOne({ _id: existing._id });
    }

    const now = new Date();
    const doc: BudgetDoc = {
      _id: dto.id ?? randomUUID(), // honour client-generated UUID for ID parity
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      categoryKey: dto.categoryKey,
      allocatedAmount: dto.allocatedAmount,
      month: dto.month,
      year: dto.year,
      carryForward: dto.carryForward ?? false,
      userId,
    };
    await this.db.budgets.insertOne(doc);
    return doc;
  }

  async remove(id: string, userId: string) {
    const b = await this.db.budgets.findOne({
      _id: id,
      userId,
      deletedAt: null,
    });
    if (!b) throw new NotFoundException();
    await this.db.budgets.updateOne(
      { _id: id },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } },
    );
  }
}
