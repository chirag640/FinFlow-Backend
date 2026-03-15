import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { DatabaseService } from "../../database/database.service";
import { InvestmentDoc } from "../../database/database.types";
import { CreateInvestmentDto } from "./dto/create-investment.dto";

@Injectable()
export class InvestmentsService {
  constructor(private db: DatabaseService) {}

  async findAll(userId: string) {
    const docs = await this.db.investments
      .find({ userId, deletedAt: null })
      .sort({ updatedAt: -1 })
      .toArray();

    const totalInvested = docs.reduce((s, d) => s + d.investedAmount, 0);
    const totalCurrentValue = docs.reduce((s, d) => s + d.currentValue, 0);

    return {
      investments: docs.map(this._toClient),
      summary: {
        totalInvested,
        totalCurrentValue,
        gainLoss: totalCurrentValue - totalInvested,
        gainLossPercent:
          totalInvested > 0
            ? ((totalCurrentValue - totalInvested) / totalInvested) * 100
            : 0,
        count: docs.length,
      },
    };
  }

  async findOne(id: string, userId: string) {
    const doc = await this.db.investments.findOne({ _id: id, deletedAt: null });
    if (!doc) throw new NotFoundException("Investment not found");
    if (doc.userId !== userId) throw new ForbiddenException();
    return this._toClient(doc);
  }

  async create(userId: string, dto: CreateInvestmentDto) {
    const now = new Date();
    const doc: InvestmentDoc = {
      _id: dto.id ?? randomUUID(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      userId,
      type: dto.type,
      name: dto.name,
      investedAmount: dto.investedAmount,
      currentValue: dto.currentValue,
      startDate: new Date(dto.startDate),
      maturityDate: dto.maturityDate ? new Date(dto.maturityDate) : null,
      interestRate: dto.interestRate ?? null,
      quantity: dto.quantity ?? null,
      purchasePrice: dto.purchasePrice ?? null,
      currentPrice: dto.currentPrice ?? null,
      notes: dto.notes ?? null,
    };
    await this.db.investments.insertOne(doc);
    return this._toClient(doc);
  }

  async update(id: string, userId: string, dto: Partial<CreateInvestmentDto>) {
    const existing = await this.db.investments.findOne({
      _id: id,
      deletedAt: null,
    });
    if (!existing) throw new NotFoundException("Investment not found");
    if (existing.userId !== userId) throw new ForbiddenException();

    const updates: Partial<InvestmentDoc> = {
      updatedAt: new Date(),
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.investedAmount !== undefined && {
        investedAmount: dto.investedAmount,
      }),
      ...(dto.currentValue !== undefined && { currentValue: dto.currentValue }),
      ...(dto.startDate !== undefined && {
        startDate: new Date(dto.startDate),
      }),
      ...(dto.maturityDate !== undefined && {
        maturityDate: new Date(dto.maturityDate),
      }),
      ...(dto.interestRate !== undefined && {
        interestRate: dto.interestRate,
      }),
      ...(dto.quantity !== undefined && { quantity: dto.quantity }),
      ...(dto.purchasePrice !== undefined && {
        purchasePrice: dto.purchasePrice,
      }),
      ...(dto.currentPrice !== undefined && { currentPrice: dto.currentPrice }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
    };

    await this.db.investments.updateOne({ _id: id }, { $set: updates });
    return this._toClient({ ...existing, ...updates } as InvestmentDoc);
  }

  async remove(id: string, userId: string) {
    const existing = await this.db.investments.findOne({
      _id: id,
      deletedAt: null,
    });
    if (!existing) throw new NotFoundException("Investment not found");
    if (existing.userId !== userId) throw new ForbiddenException();

    await this.db.investments.updateOne(
      { _id: id },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } },
    );
  }

  async netWorth(userId: string) {
    const result = await this.db.investments
      .aggregate<{ totalCurrentValue: number; totalInvested: number }>([
        { $match: { userId, deletedAt: null } },
        {
          $group: {
            _id: null,
            totalCurrentValue: { $sum: "$currentValue" },
            totalInvested: { $sum: "$investedAmount" },
          },
        },
      ])
      .toArray();

    const row = result[0];
    return {
      totalCurrentValue: row?.totalCurrentValue ?? 0,
      totalInvested: row?.totalInvested ?? 0,
      gainLoss: (row?.totalCurrentValue ?? 0) - (row?.totalInvested ?? 0),
    };
  }

  private _toClient(doc: InvestmentDoc) {
    return {
      id: doc._id,
      type: doc.type,
      name: doc.name,
      investedAmount: doc.investedAmount,
      currentValue: doc.currentValue,
      startDate: doc.startDate,
      maturityDate: doc.maturityDate,
      interestRate: doc.interestRate,
      quantity: doc.quantity,
      purchasePrice: doc.purchasePrice,
      currentPrice: doc.currentPrice,
      notes: doc.notes,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
