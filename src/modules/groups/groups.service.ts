import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { DatabaseService } from "../../database/database.service";
import { EncryptionService } from "../../common/services/encryption.service";
import {
  GroupDoc,
  GroupMemberDoc,
  GroupExpenseDoc,
} from "../../database/database.types";
import { CreateGroupDto } from "./dto/create-group.dto";
import { AddGroupExpenseDto } from "./dto/add-group-expense.dto";
import { AddMemberDto } from "./dto/add-member.dto";

@Injectable()
export class GroupsService {
  constructor(
    private db: DatabaseService,
    private encryption: EncryptionService,
  ) {}

  async findAll(userId: string) {
    const memberGroups = await this.db.groupMembers
      .find({ userId })
      .project({ groupId: 1 })
      .toArray();
    const memberGroupIds = memberGroups.map((m) => m.groupId);

    const groups = await this.db.groups
      .find({
        deletedAt: null,
        $or: [{ ownerId: userId }, { _id: { $in: memberGroupIds } }],
      })
      .sort({ updatedAt: -1 })
      .toArray();

    const result = await Promise.all(
      groups.map(async (g) => {
        const [members, expenseCount] = await Promise.all([
          this.db.groupMembers.find({ groupId: g._id }).toArray(),
          this.db.groupExpenses.countDocuments({
            groupId: g._id,
            deletedAt: null,
          }),
        ]);
        return { ...g, id: g._id, members, _count: { expenses: expenseCount } };
      }),
    );
    return result;
  }

  async findOne(id: string, userId: string) {
    const group = await this.db.groups.findOne({ _id: id, deletedAt: null });
    if (!group) throw new NotFoundException("Group not found");

    const [members, expenses] = await Promise.all([
      this.db.groupMembers.find({ groupId: id }).toArray(),
      this.db.groupExpenses
        .find({ groupId: id, deletedAt: null })
        .sort({ date: -1 })
        .toArray(),
    ]);

    await this._assertMember(id, group.ownerId, userId);
    return { ...group, id: group._id, members, expenses };
  }

  async create(userId: string, dto: CreateGroupDto) {
    // Resolve the creator's real name for their member record so it displays
    // correctly on all devices instead of showing the hardcoded string "You".
    const creator = await this.db.users.findOne(
      { _id: userId, deletedAt: null },
      { projection: { name: 1 } },
    );
    const creatorName = creator ? this.encryption.decrypt(creator.name) : "You";

    const now = new Date();
    const group: GroupDoc = {
      _id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ownerId: userId,
      name: dto.name,
      emoji: dto.emoji ?? "👥",
      description: dto.description ?? null,
    };
    await this.db.groups.insertOne(group);

    const member: GroupMemberDoc = {
      _id: randomUUID(),
      createdAt: now,
      groupId: group._id,
      userId,
      name: creatorName,
    };
    await this.db.groupMembers.insertOne(member);

    return { ...group, id: group._id, members: [member] };
  }

  async update(id: string, userId: string, dto: Partial<CreateGroupDto>) {
    const group = await this.db.groups.findOne({ _id: id, deletedAt: null });
    if (!group) throw new NotFoundException();
    if (group.ownerId !== userId) throw new ForbiddenException();
    await this.db.groups.updateOne(
      { _id: id },
      { $set: { ...dto, updatedAt: new Date() } },
    );
    return this.db.groups.findOne({ _id: id });
  }

  async remove(id: string, userId: string) {
    const group = await this.db.groups.findOne({ _id: id, deletedAt: null });
    if (!group) throw new NotFoundException();
    if (group.ownerId !== userId) throw new ForbiddenException();
    await this.db.groups.updateOne(
      { _id: id },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } },
    );
  }

  async addMember(groupId: string, userId: string, dto: AddMemberDto) {
    const group = await this.db.groups.findOne({
      _id: groupId,
      deletedAt: null,
    });
    if (!group) throw new NotFoundException();
    if (group.ownerId !== userId) throw new ForbiddenException();

    let name = dto.name ?? "Member";
    if (dto.userId) {
      const user = await this.db.users.findOne({
        _id: dto.userId,
        deletedAt: null,
      });
      if (user) name = this.encryption.decrypt(user.name);
    }

    const member: GroupMemberDoc = {
      _id: randomUUID(),
      createdAt: new Date(),
      groupId,
      userId: dto.userId ?? null,
      name,
    };
    await this.db.groupMembers.insertOne(member);
    return member;
  }

  async addExpense(groupId: string, userId: string, dto: AddGroupExpenseDto) {
    const group = await this.db.groups.findOne({
      _id: groupId,
      deletedAt: null,
    });
    if (!group) throw new NotFoundException();
    await this._assertMember(groupId, group.ownerId, userId);

    const now = new Date();
    const expense: GroupExpenseDoc = {
      _id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      groupId,
      amount: dto.amount,
      description: dto.description,
      paidByMemberId: dto.paidByMemberId,
      splitType: dto.splitType,
      shares: dto.shares as Array<{ memberId: string; amount: number }>,
      note: dto.note ?? null,
      date: new Date(dto.date),
    };
    await this.db.groupExpenses.insertOne(expense);
    return expense;
  }

  async getSettlements(groupId: string, userId: string) {
    const group = await this.db.groups.findOne({
      _id: groupId,
      deletedAt: null,
    });
    if (!group) throw new NotFoundException();
    await this._assertMember(groupId, group.ownerId, userId);

    const [members, expenses] = await Promise.all([
      this.db.groupMembers.find({ groupId }).toArray(),
      this.db.groupExpenses.find({ groupId, deletedAt: null }).toArray(),
    ]);

    const balances: Record<string, number> = {};
    for (const m of members) balances[m._id] = 0;

    for (const exp of expenses) {
      balances[exp.paidByMemberId] =
        (balances[exp.paidByMemberId] ?? 0) + exp.amount;
      for (const s of exp.shares) {
        balances[s.memberId] = (balances[s.memberId] ?? 0) - s.amount;
      }
    }

    const settlements: Array<{ from: string; to: string; amount: number }> = [];
    const creditors = Object.entries(balances)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    const debtors = Object.entries(balances)
      .filter(([, v]) => v < 0)
      .sort((a, b) => a[1] - b[1]);

    let ci = 0,
      di = 0;
    while (ci < creditors.length && di < debtors.length) {
      const [cid, camt] = creditors[ci];
      const [did, damt] = debtors[di];
      const settle = Math.min(camt, -damt);
      settlements.push({
        from: did,
        to: cid,
        amount: Math.round(settle * 100) / 100,
      });
      creditors[ci][1] -= settle;
      debtors[di][1] += settle;
      if (Math.abs(creditors[ci][1]) < 0.01) ci++;
      if (Math.abs(debtors[di][1]) < 0.01) di++;
    }

    return { balances, settlements, members };
  }

  async settleUp(
    groupId: string,
    userId: string,
    fromMemberId: string,
    toMemberId: string,
    amount: number,
  ) {
    if (fromMemberId === toMemberId)
      throw new BadRequestException("Cannot settle with yourself");

    const group = await this.db.groups.findOne({
      _id: groupId,
      deletedAt: null,
    });
    if (!group) throw new NotFoundException();
    await this._assertMember(groupId, group.ownerId, userId);

    const [fromMember, toMember] = await Promise.all([
      this.db.groupMembers.findOne({ _id: fromMemberId, groupId }),
      this.db.groupMembers.findOne({ _id: toMemberId, groupId }),
    ]);

    const now = new Date();
    const expense: GroupExpenseDoc = {
      _id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      groupId,
      amount,
      description: `Settlement: ${fromMember?.name ?? "Unknown"} → ${toMember?.name ?? "Unknown"}`,
      paidByMemberId: fromMemberId,
      splitType: "custom",
      shares: [{ memberId: toMemberId, amount }],
      note: "Debt settlement",
      date: now,
      isSettlement: true,
    };
    await this.db.groupExpenses.insertOne(expense);
    return expense;
  }

  async removeExpense(groupId: string, expenseId: string, userId: string) {
    const group = await this.db.groups.findOne({
      _id: groupId,
      deletedAt: null,
    });
    if (!group) throw new NotFoundException();
    await this._assertMember(groupId, group.ownerId, userId);

    const expense = await this.db.groupExpenses.findOne({
      _id: expenseId,
      groupId,
      deletedAt: null,
    });
    if (!expense) throw new NotFoundException("Expense not found");
    if (expense.isSettlement)
      throw new BadRequestException("Settlement records cannot be deleted");

    await this.db.groupExpenses.updateOne(
      { _id: expenseId },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } },
    );
  }

  private async _assertMember(
    groupId: string,
    ownerId: string,
    userId: string,
  ) {
    if (ownerId === userId) return;
    const member = await this.db.groupMembers.findOne({ groupId, userId });
    if (!member) throw new ForbiddenException();
  }
}
