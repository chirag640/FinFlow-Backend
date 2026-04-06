import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { EncryptionService } from "../../common/services/encryption.service";
import { DatabaseService } from "../../database/database.service";
import {
  GroupDoc,
  GroupExpenseDoc,
  GroupMemberDoc,
} from "../../database/database.types";
import { NotificationsService } from "../notifications/notifications.service";
import { AddGroupExpenseDto } from "./dto/add-group-expense.dto";
import { AddMemberDto } from "./dto/add-member.dto";
import { CreateGroupDto } from "./dto/create-group.dto";

type GroupExpenseSortField = "date" | "amount" | "createdAt";
type GroupExpensePageQuery = {
  cursor?: string;
  take?: number;
  sortBy?: GroupExpenseSortField;
  order?: "asc" | "desc";
};

type GroupDocLite = Pick<
  GroupDoc,
  | "_id"
  | "name"
  | "emoji"
  | "description"
  | "ownerId"
  | "createdAt"
  | "updatedAt"
>;

type GroupMemberDocLite = Pick<
  GroupMemberDoc,
  "_id" | "groupId" | "name" | "username" | "userId"
>;

type GroupExpenseDocLite = Pick<
  GroupExpenseDoc,
  | "_id"
  | "groupId"
  | "amount"
  | "description"
  | "paidByMemberId"
  | "splitType"
  | "shares"
  | "note"
  | "date"
  | "isSettlement"
>;

type GroupExpenseFilter = {
  groupId: string;
  deletedAt: null;
  [key: string]:
    | string
    | null
    | { $gt: Date | number; $lt?: never }
    | { $lt: Date | number; $gt?: never };
};

type GroupMemberResponse = {
  id: string;
  name: string;
  username: string | null;
  userId: string | null;
};

type GroupExpenseResponse = {
  id: string;
  groupId: string;
  amount: number;
  description: string;
  paidByMemberId: string;
  splitType: string;
  shares: Array<{ memberId: string; amount: number }>;
  note: string | null;
  date: Date;
  isSettlement: boolean;
};

const GROUP_EXPENSE_SORT_FIELDS: GroupExpenseSortField[] = [
  "date",
  "amount",
  "createdAt",
];
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GroupResponse = {
  id: string;
  name: string;
  emoji: string;
  description: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  members: GroupMemberResponse[];
};

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    private db: DatabaseService,
    private encryption: EncryptionService,
    private notifications: NotificationsService,
  ) {}

  async findAll(userId: string) {
    // Step 1: Get group IDs where user is a member
    const memberGroups = await this.db.groupMembers
      .find({ userId })
      .project({ groupId: 1 })
      .toArray();
    const memberGroupIds = memberGroups.map((m) => m.groupId);

    // Step 2: Get all groups the user owns or is a member of
    const groups = await this.db.groups
      .find({
        deletedAt: null,
        $or: [{ ownerId: userId }, { _id: { $in: memberGroupIds } }],
      })
      .project<GroupDocLite>({
        _id: 1,
        name: 1,
        emoji: 1,
        description: 1,
        ownerId: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .toArray();

    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g._id);

    // Step 3: Batch fetch all members for all groups in ONE query
    const allMembers = await this.db.groupMembers
      .find({ groupId: { $in: groupIds } })
      .project<GroupMemberDocLite>({
        _id: 1,
        groupId: 1,
        name: 1,
        username: 1,
        userId: 1,
      })
      .toArray();

    // Step 4: Batch fetch expense counts for all groups in ONE aggregation
    const expenseCounts = await this.db.groupExpenses
      .aggregate<{
        _id: string;
        count: number;
      }>([
        { $match: { groupId: { $in: groupIds }, deletedAt: null } },
        { $group: { _id: "$groupId", count: { $sum: 1 } } },
      ])
      .toArray();

    const expenseCountByGroup = new Map(
      expenseCounts.map((e) => [e._id, e.count]),
    );

    // Step 5: Group members by groupId
    const membersByGroup = new Map<string, GroupMemberDocLite[]>();
    for (const member of allMembers) {
      const existing = membersByGroup.get(member.groupId) ?? [];
      existing.push(member);
      membersByGroup.set(member.groupId, existing);
    }

    // Step 6: Batch fetch usernames for all members in ONE query
    const allMembersWithUsernames = await this._withMemberUsernames(allMembers);
    const memberWithUsernameById = new Map(
      allMembersWithUsernames.map((m) => [m._id, m]),
    );

    // Step 7: Assemble results
    return groups.map((g) => {
      const groupMembers = membersByGroup.get(g._id) ?? [];
      const membersWithUsername = groupMembers.map(
        (m) => memberWithUsernameById.get(m._id) ?? m,
      );

      return {
        ...this._toGroupResponse(g, membersWithUsername),
        expenseCount: expenseCountByGroup.get(g._id) ?? 0,
      };
    });
  }

  async findOne(id: string, userId: string) {
    const group = await this.db.groups.findOne(
      { _id: id, deletedAt: null },
      {
        projection: {
          _id: 1,
          name: 1,
          emoji: 1,
          description: 1,
          ownerId: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    );
    if (!group) throw new NotFoundException("Group not found");

    const [members, expenses] = await Promise.all([
      this.db.groupMembers
        .find({ groupId: id })
        .project<GroupMemberDocLite>({
          _id: 1,
          groupId: 1,
          name: 1,
          username: 1,
          userId: 1,
        })
        .toArray(),
      this.db.groupExpenses
        .find({ groupId: id, deletedAt: null })
        .project<GroupExpenseDocLite>({
          _id: 1,
          groupId: 1,
          amount: 1,
          description: 1,
          paidByMemberId: 1,
          splitType: 1,
          shares: 1,
          note: 1,
          date: 1,
          isSettlement: 1,
        })
        .sort({ date: -1 })
        .toArray(),
    ]);
    const membersWithUsername = await this._withMemberUsernames(members);

    await this._assertMember(id, group.ownerId, userId);

    return {
      ...this._toGroupResponse(group, membersWithUsername),
      expenses: expenses.map((e) => this._toGroupExpenseResponse(e)),
      expenseCount: expenses.length,
    };
  }

  async create(userId: string, dto: CreateGroupDto) {
    // Resolve the creator's real name for their member record so it displays
    // correctly on all devices instead of showing the hardcoded string "You".
    const creator = await this.db.users.findOne(
      { _id: userId, deletedAt: null },
      { projection: { name: 1, username: 1 } },
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
      username: creator?.username ?? null,
    };
    await this.db.groupMembers.insertOne(member);

    return this._toGroupResponse(group, [member]);
  }

  async update(id: string, userId: string, dto: Partial<CreateGroupDto>) {
    const group = await this.db.groups.findOne({ _id: id, deletedAt: null });
    if (!group) throw new NotFoundException();
    if (group.ownerId !== userId) throw new ForbiddenException();
    await this.db.groups.updateOne(
      { _id: id },
      { $set: { ...dto, updatedAt: new Date() } },
    );

    const [updated, members] = await Promise.all([
      this.db.groups.findOne(
        { _id: id, deletedAt: null },
        {
          projection: {
            _id: 1,
            name: 1,
            emoji: 1,
            description: 1,
            ownerId: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      ),
      this.db.groupMembers
        .find({ groupId: id })
        .project<GroupMemberDocLite>({
          _id: 1,
          groupId: 1,
          name: 1,
          username: 1,
          userId: 1,
        })
        .toArray(),
    ]);

    if (!updated) throw new NotFoundException();

    const membersWithUsername = await this._withMemberUsernames(members);
    return this._toGroupResponse(updated, membersWithUsername);
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
    let username: string | null = null;
    if (dto.userId) {
      const user = await this.db.users.findOne({
        _id: dto.userId,
        deletedAt: null,
      });
      if (user) {
        name = this.encryption.decrypt(user.name);
        username = user.username ?? null;
      }
    }

    const member: GroupMemberDoc = {
      _id: randomUUID(),
      createdAt: new Date(),
      groupId,
      userId: dto.userId ?? null,
      name,
      username,
    };
    await this.db.groupMembers.insertOne(member);

    if (dto.userId && dto.userId !== userId) {
      const addedByName = await this._displayNameForUser(userId);
      this._dispatchNotification(
        this.notifications.notifyGroupMemberAdded({
          addedUserId: dto.userId,
          groupId,
          groupName: group.name,
          addedByName,
        }),
      );
    }

    return this._toGroupMemberResponse(member);
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

    const members = await this.db.groupMembers.find({ groupId }).toArray();
    const recipientUserIds = Array.from(
      new Set(
        members
          .map((m) => m.userId)
          .filter((id): id is string => Boolean(id && id.trim()))
          .filter((id) => id !== userId),
      ),
    );

    if (recipientUserIds.length > 0) {
      const actorName = await this._displayNameForUser(userId);
      this._dispatchNotification(
        this.notifications.notifyGroupExpenseAdded({
          recipientUserIds,
          groupId,
          groupName: group.name,
          description: dto.description,
          amount: dto.amount,
          actorName,
        }),
      );

      if (this.notifications.isLargeGroupExpense(dto.amount)) {
        this._dispatchNotification(
          this.notifications.notifyLargeExpenseApprovalRequest({
            recipientUserIds,
            groupId,
            groupName: group.name,
            description: dto.description,
            amount: dto.amount,
            actorName,
          }),
        );
      }
    }

    return this._toGroupExpenseResponse(expense);
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
    const membersWithUsername = await this._withMemberUsernames(members);

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

    return {
      balances,
      settlements,
      members: membersWithUsername.map((m) => this._toGroupMemberResponse(m)),
    };
  }

  async getGroupExpenses(
    groupId: string,
    userId: string,
    query: GroupExpensePageQuery,
  ) {
    const group = await this.db.groups.findOne({
      _id: groupId,
      deletedAt: null,
    });
    if (!group) throw new NotFoundException();
    await this._assertMember(groupId, group.ownerId, userId);

    const take = query.take ?? 20;
    const sortBy = GROUP_EXPENSE_SORT_FIELDS.includes(
      query.sortBy as GroupExpenseSortField,
    )
      ? (query.sortBy as GroupExpenseSortField)
      : "date";
    const order = query.order === "asc" ? "asc" : "desc";
    const sortDirection = order === "asc" ? 1 : -1;

    // Build filter
    const filter: GroupExpenseFilter = { groupId, deletedAt: null };

    if (typeof query.cursor === "string" && UUID_V4_REGEX.test(query.cursor)) {
      const cursorDoc = await this.db.groupExpenses.findOne(
        {
          _id: query.cursor,
          groupId,
          deletedAt: null,
        },
        { projection: { _id: 1, date: 1, amount: 1, createdAt: 1 } },
      );

      if (cursorDoc) {
        const cursorValue =
          sortBy === "date"
            ? cursorDoc.date
            : sortBy === "amount"
              ? cursorDoc.amount
              : cursorDoc.createdAt;
        filter[sortBy] =
          order === "asc" ? { $gt: cursorValue } : { $lt: cursorValue };
      } else {
        this.logger.warn(
          `Invalid cursor for group ${groupId}: ${query.cursor}`,
        );
      }
    } else if (query.cursor) {
      this.logger.warn(
        `Rejected non-UUID cursor for group ${groupId}: ${query.cursor}`,
      );
    }

    // Fetch page and total in parallel.
    const [expenses, total] = await Promise.all([
      this.db.groupExpenses
        .find(filter)
        .project<GroupExpenseDocLite>({
          _id: 1,
          groupId: 1,
          amount: 1,
          description: 1,
          paidByMemberId: 1,
          splitType: 1,
          shares: 1,
          note: 1,
          date: 1,
          isSettlement: 1,
          createdAt: 1,
        })
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .limit(take + 1)
        .toArray(),
      this.db.groupExpenses.countDocuments({ groupId, deletedAt: null }),
    ]);

    const hasMore = expenses.length > take;
    const data = hasMore ? expenses.slice(0, take) : expenses;
    const nextCursor =
      hasMore && data.length > 0 ? data[data.length - 1]._id : null;

    return {
      data: data.map((e) => this._toGroupExpenseResponse(e)),
      nextCursor,
      hasMore,
      total,
    };
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

    const recipientUserIds = Array.from(
      new Set(
        [fromMember?.userId, toMember?.userId]
          .filter((id): id is string => Boolean(id && id.trim()))
          .filter((id) => id !== userId),
      ),
    );

    this._dispatchNotification(
      this.notifications.notifySettlementRecorded({
        recipientUserIds,
        groupId,
        groupName: group.name,
        fromName: this._displayMemberName(fromMember),
        toName: this._displayMemberName(toMember),
        amount,
      }),
    );

    return this._toGroupExpenseResponse(expense);
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

    // Only group owner or the person who paid can delete an expense
    const isOwner = group.ownerId === userId;
    if (!isOwner) {
      const paidByMember = await this.db.groupMembers.findOne({
        _id: expense.paidByMemberId,
        groupId,
      });
      if (!paidByMember || paidByMember.userId !== userId) {
        throw new ForbiddenException(
          "Only the group owner or expense creator can delete this expense",
        );
      }
    }

    await this.db.groupExpenses.updateOne(
      { _id: expenseId },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } },
    );
  }

  private async _withMemberUsernames(
    members: GroupMemberDocLite[],
  ): Promise<Array<GroupMemberDocLite & { username?: string | null }>> {
    const userIds = Array.from(
      new Set(
        members
          .map((m) => m.userId)
          .filter((id): id is string => Boolean(id && id.trim())),
      ),
    );

    if (userIds.length === 0) {
      return members;
    }

    const users = await this.db.users
      .find({ _id: { $in: userIds }, deletedAt: null })
      .project({ _id: 1, username: 1 })
      .toArray();

    const usernameByUserId = new Map(
      users.map((u) => [u._id, u.username ?? null]),
    );

    return members.map((m) => ({
      ...m,
      username:
        m.username ??
        (m.userId ? (usernameByUserId.get(m.userId) ?? null) : null),
    }));
  }

  private _toGroupMemberResponse(
    member: GroupMemberDocLite & { username?: string | null },
  ): GroupMemberResponse {
    return {
      id: member._id,
      name: member.name,
      username: member.username ?? null,
      userId: member.userId ?? null,
    };
  }

  private _toGroupExpenseResponse(
    expense: GroupExpenseDocLite,
  ): GroupExpenseResponse {
    return {
      id: expense._id,
      groupId: expense.groupId,
      amount: expense.amount,
      description: expense.description,
      paidByMemberId: expense.paidByMemberId,
      splitType: expense.splitType,
      shares: (expense.shares ?? []).map((s) => ({
        memberId: s.memberId,
        amount: s.amount,
      })),
      note: expense.note ?? null,
      date: expense.date,
      isSettlement: expense.isSettlement ?? false,
    };
  }

  private _toGroupResponse(
    group: GroupDocLite,
    members: Array<GroupMemberDocLite & { username?: string | null }>,
  ): GroupResponse {
    return {
      id: group._id,
      name: group.name,
      emoji: group.emoji,
      description: group.description ?? null,
      ownerId: group.ownerId,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      members: members.map((m) => this._toGroupMemberResponse(m)),
    };
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

  private _dispatchNotification(work: Promise<void>) {
    work.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Notification dispatch failed: ${message}`);
    });
  }

  private async _displayNameForUser(userId: string): Promise<string> {
    const user = await this.db.users.findOne(
      { _id: userId, deletedAt: null },
      { projection: { name: 1, username: 1 } },
    );
    if (!user) return "Someone";
    if (user.username?.trim()) return `@${user.username}`;
    return this.encryption.decrypt(user.name);
  }

  private _displayMemberName(
    member: GroupMemberDoc | null | undefined,
  ): string {
    if (!member) return "a member";
    if (member.username?.trim()) return `@${member.username}`;
    return member.name || "a member";
  }
}
