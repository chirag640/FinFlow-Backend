import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { randomUUID } from "crypto";
import * as admin from "firebase-admin";
import { MongoServerError } from "mongodb";
import { DatabaseService } from "../../database/database.service";
import { GroupExpenseDoc, GroupMemberDoc } from "../../database/database.types";
import { NOTIFICATION_CONFIG, DB_ERROR_CODES, TIME_CONSTANTS } from "../../common/constants";

type FcmPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private messaging: admin.messaging.Messaging | null = null;
  private readonly largeExpenseApprovalThreshold = this._numberFromEnv(
    "GROUP_LARGE_EXPENSE_APPROVAL_THRESHOLD",
    NOTIFICATION_CONFIG.LARGE_EXPENSE_THRESHOLD,
  );
  private readonly inactiveMemberDays = this._numberFromEnv(
    "GROUP_INACTIVE_MEMBER_DAYS",
    NOTIFICATION_CONFIG.INACTIVITY_DAYS,
  );
  private readonly trackedSpikeCategories = ["food", "travel"];
  private readonly budgetThresholds = NOTIFICATION_CONFIG.BUDGET_ALERT_PERCENTAGES;

  constructor(private readonly db: DatabaseService) {
    this.initializeFirebase();
  }

  getHealthStatus() {
    return {
      fcmConfigured: this.messaging !== null,
    };
  }

  async registerDevice(userId: string, token: string, platform?: string) {
    const normalizedToken = token.trim();
    const now = new Date();

    await this.db.pushDevices.updateOne(
      { token: normalizedToken },
      {
        $set: {
          userId,
          token: normalizedToken,
          platform: platform?.trim() || null,
          updatedAt: now,
          lastSeenAt: now,
          disabledAt: null,
        },
        $setOnInsert: {
          _id: randomUUID(),
          createdAt: now,
        },
      },
      { upsert: true },
    );

    return { registered: true };
  }

  async unregisterDevice(userId: string, token: string) {
    const normalizedToken = token.trim();
    await this.db.pushDevices.updateMany(
      { userId, token: normalizedToken, disabledAt: null },
      {
        $set: {
          disabledAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
  }

  isLargeGroupExpense(amount: number): boolean {
    return amount >= this.largeExpenseApprovalThreshold;
  }

  async notifyGroupMemberAdded(input: {
    addedUserId: string;
    groupId: string;
    groupName: string;
    addedByName: string;
  }) {
    await this.sendToUsers([input.addedUserId], {
      title: `Added to ${input.groupName}`,
      body: `${input.addedByName} added you to this group.`,
      data: {
        type: "group_member_added",
        groupId: input.groupId,
      },
    });
  }

  async notifyGroupExpenseAdded(input: {
    recipientUserIds: string[];
    groupId: string;
    groupName: string;
    description: string;
    amount: number;
    actorName: string;
  }) {
    const amountText = this.formatAmount(input.amount);
    await this.sendToUsers(input.recipientUserIds, {
      title: `New expense in ${input.groupName}`,
      body: `${input.actorName} added ${input.description} (${amountText}).`,
      data: {
        type: "group_expense_added",
        groupId: input.groupId,
      },
    });
  }

  async notifyLargeExpenseApprovalRequest(input: {
    recipientUserIds: string[];
    groupId: string;
    groupName: string;
    description: string;
    amount: number;
    actorName: string;
  }) {
    if (input.recipientUserIds.length === 0) return;

    await this.sendToUsers(input.recipientUserIds, {
      title: `Approval needed in ${input.groupName}`,
      body: `${input.actorName} added a large expense (${this.formatAmount(input.amount)}) for ${input.description}.`,
      data: {
        type: "large_group_expense_approval",
        groupId: input.groupId,
      },
    });
  }

  async notifySettlementRecorded(input: {
    recipientUserIds: string[];
    groupId: string;
    groupName: string;
    fromName: string;
    toName: string;
    amount: number;
  }) {
    if (input.recipientUserIds.length === 0) return;

    await this.sendToUsers(input.recipientUserIds, {
      title: `Settlement in ${input.groupName}`,
      body: `${input.fromName} settled ${this.formatAmount(input.amount)} with ${input.toName}.`,
      data: {
        type: "group_settlement_recorded",
        groupId: input.groupId,
      },
    });
  }

  @Cron("0 0 21 * * *")
  async sendDailyExpenseSummary() {
    if (!this.messaging) return;

    const userIds = await this.distinctActiveDeviceUserIds();
    if (userIds.length === 0) return;

    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(
      NOTIFICATION_CONFIG.END_OF_DAY_HOURS,
      NOTIFICATION_CONFIG.END_OF_DAY_MINUTES,
      NOTIFICATION_CONFIG.END_OF_DAY_SECONDS,
      NOTIFICATION_CONFIG.END_OF_DAY_MILLISECONDS,
    );

    // Batch aggregation: get summaries for ALL users in ONE query
    const summaries = await this.db.expenses
      .aggregate<{ _id: string; count: number; total: number }>([
        {
          $match: {
            userId: { $in: userIds },
            deletedAt: null,
            isIncome: false,
            date: { $gte: dayStart, $lte: dayEnd },
          },
        },
        {
          $group: {
            _id: "$userId",
            count: { $sum: 1 },
            total: { $sum: "$amount" },
          },
        },
      ])
      .toArray();

    const summaryByUser = new Map(summaries.map((s) => [s._id, s]));

    for (const userId of userIds) {
      const summary = summaryByUser.get(userId);
      const count = summary?.count ?? 0;
      const total = summary?.total ?? 0;
      if (count <= 0 || total <= 0) continue;

      await this.sendOnceToUser(
        userId,
        `daily-expense-summary:${dayStart.toISOString().split("T")[0]}`,
        {
          title: "Today's Expense Summary",
          body: `You logged ${count} expense${count == 1 ? "" : "s"} totaling ${this.formatAmount(total)} today.`,
          data: {
            type: "daily_expense_summary",
            date: dayStart.toISOString().split("T")[0],
            count: String(count),
            total: total.toFixed(2),
          },
        },
        3,
      );
    }
  }

  @Cron("0 30 9 * * *")
  async sendPendingSettlementReminders() {
    if (!this.messaging) return;

    const groups = await this.db.groups.find({ deletedAt: null }).toArray();
    if (groups.length === 0) return;

    const dayKey = this.dateKey(new Date());
    const groupIds = groups.map((g) => g._id);

    // Batch fetch ALL members and expenses for ALL groups
    const [allMembers, allExpenses] = await Promise.all([
      this.db.groupMembers.find({ groupId: { $in: groupIds } }).toArray(),
      this.db.groupExpenses
        .find({ groupId: { $in: groupIds }, deletedAt: null })
        .toArray(),
    ]);

    // Group by groupId
    const membersByGroup = new Map<string, GroupMemberDoc[]>();
    const expensesByGroup = new Map<string, GroupExpenseDoc[]>();

    for (const member of allMembers) {
      const existing = membersByGroup.get(member.groupId) ?? [];
      existing.push(member);
      membersByGroup.set(member.groupId, existing);
    }

    for (const expense of allExpenses) {
      const existing = expensesByGroup.get(expense.groupId) ?? [];
      existing.push(expense);
      expensesByGroup.set(expense.groupId, existing);
    }

    for (const group of groups) {
      const members = membersByGroup.get(group._id) ?? [];
      const expenses = expensesByGroup.get(group._id) ?? [];
      if (members.length === 0 || expenses.length === 0) continue;

      const balances = this.computeGroupBalances(members, expenses);
      for (const member of members) {
        const userId = member.userId?.trim();
        if (!userId) continue;

        const net = balances[member._id] ?? 0;
        if (net >= -0.01) continue;

        const amount = Math.abs(net);
        await this.sendOnceToUser(
          userId,
          `pending-settlement:${group._id}:${member._id}:${dayKey}`,
          {
            title: `Pending settlement in ${group.name}`,
            body: `You still owe ${this.formatAmount(amount)}. Settle today to keep balances clean.`,
            data: {
              type: "pending_settlement_reminder",
              groupId: group._id,
              amount: amount.toFixed(2),
            },
          },
          3,
        );
      }
    }
  }

  @Cron("0 0 20 * * 0")
  async sendWeeklyGroupDigest() {
    if (!this.messaging) return;

    const now = new Date();
    const weekKey = this.isoWeekKey(now);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const groups = await this.db.groups.find({ deletedAt: null }).toArray();
    if (groups.length === 0) return;

    const groupIds = groups.map((g) => g._id);

    // Batch fetch ALL data in 3 queries instead of 3N
    const [allMembers, allExpenses, weekSummaries] = await Promise.all([
      this.db.groupMembers.find({ groupId: { $in: groupIds } }).toArray(),
      this.db.groupExpenses
        .find({ groupId: { $in: groupIds }, deletedAt: null })
        .toArray(),
      this.db.groupExpenses
        .aggregate<{ _id: string; count: number; total: number }>([
          {
            $match: {
              groupId: { $in: groupIds },
              deletedAt: null,
              isSettlement: { $ne: true },
              date: { $gte: weekStart },
            },
          },
          {
            $group: {
              _id: "$groupId",
              count: { $sum: 1 },
              total: { $sum: "$amount" },
            },
          },
        ])
        .toArray(),
    ]);

    // Index by groupId
    const membersByGroup = new Map<string, GroupMemberDoc[]>();
    const expensesByGroup = new Map<string, GroupExpenseDoc[]>();
    const weekSummaryByGroup = new Map(weekSummaries.map((s) => [s._id, s]));

    for (const member of allMembers) {
      const existing = membersByGroup.get(member.groupId) ?? [];
      existing.push(member);
      membersByGroup.set(member.groupId, existing);
    }

    for (const expense of allExpenses) {
      const existing = expensesByGroup.get(expense.groupId) ?? [];
      existing.push(expense);
      expensesByGroup.set(expense.groupId, existing);
    }

    for (const group of groups) {
      const members = membersByGroup.get(group._id) ?? [];
      const allGroupExpenses = expensesByGroup.get(group._id) ?? [];
      const weekSummary = weekSummaryByGroup.get(group._id);

      if (members.length === 0) continue;

      const balances = this.computeGroupBalances(members, allGroupExpenses);
      const count = weekSummary?.count ?? 0;
      const total = weekSummary?.total ?? 0;

      for (const member of members) {
        const userId = member.userId?.trim();
        if (!userId) continue;

        const net = balances[member._id] ?? 0;
        const balanceLine =
          net < -0.01
            ? `You owe ${this.formatAmount(Math.abs(net))}.`
            : net > 0.01
              ? `You should get ${this.formatAmount(net)} back.`
              : "You are settled up.";

        await this.sendOnceToUser(
          userId,
          `weekly-group-digest:${group._id}:${weekKey}`,
          {
            title: `Weekly digest: ${group.name}`,
            body: `${count} expense${count == 1 ? "" : "s"} totaling ${this.formatAmount(total)}. ${balanceLine}`,
            data: {
              type: "weekly_group_digest",
              groupId: group._id,
              week: weekKey,
            },
          },
          10,
        );
      }
    }
  }

  @Cron("0 30 18 * * *")
  async sendCategorySpikeAlerts() {
    if (!this.messaging) return;

    const userIds = await this.distinctActiveDeviceUserIds();
    if (userIds.length === 0) return;

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(
      NOTIFICATION_CONFIG.END_OF_DAY_HOURS,
      NOTIFICATION_CONFIG.END_OF_DAY_MINUTES,
      NOTIFICATION_CONFIG.END_OF_DAY_SECONDS,
      NOTIFICATION_CONFIG.END_OF_DAY_MILLISECONDS,
    );
    const prevStart = new Date(todayStart);
    prevStart.setDate(prevStart.getDate() - 7);
    const prevEnd = new Date(todayStart);
    prevEnd.setMilliseconds(-1);
    const dayKey = this.dateKey(now);

    // Batch fetch today's totals for ALL users, grouped by userId and category
    const todayTotals = await this.db.expenses
      .aggregate<{ userId: string; category: string; total: number }>([
        {
          $match: {
            userId: { $in: userIds },
            deletedAt: null,
            isIncome: false,
            date: { $gte: todayStart, $lte: todayEnd },
            category: { $in: this.trackedSpikeCategories },
          },
        },
        {
          $group: {
            _id: { userId: "$userId", category: "$category" },
            total: { $sum: "$amount" },
          },
        },
        {
          $project: {
            _id: 0,
            userId: "$_id.userId",
            category: "$_id.category",
            total: 1,
          },
        },
        { $match: { total: { $gte: NOTIFICATION_CONFIG.CATEGORY_SPIKE_MIN_AMOUNT } } },
      ])
      .toArray();

    if (todayTotals.length === 0) return;

    // Batch fetch baseline totals for ALL relevant user+category combos
    const baselineTotals = await this.db.expenses
      .aggregate<{ userId: string; category: string; total: number }>([
        {
          $match: {
            userId: { $in: userIds },
            deletedAt: null,
            isIncome: false,
            date: { $gte: prevStart, $lte: prevEnd },
            category: { $in: this.trackedSpikeCategories },
          },
        },
        {
          $group: {
            _id: { userId: "$userId", category: "$category" },
            total: { $sum: "$amount" },
          },
        },
        {
          $project: {
            _id: 0,
            userId: "$_id.userId",
            category: "$_id.category",
            total: 1,
          },
        },
      ])
      .toArray();

    const baselineMap = new Map(
      baselineTotals.map((b) => [`${b.userId}:${b.category}`, b.total]),
    );

    for (const row of todayTotals) {
      const category = (row.category ?? "").toLowerCase();
      const baselineTotal = baselineMap.get(`${row.userId}:${category}`) ?? 0;
      const avg = baselineTotal / 7;
      if (avg <= 0) continue;

      const ratio = row.total / avg;
      if (ratio < 1.8) continue;

      await this.sendOnceToUser(
        row.userId,
        `category-spike:${category}:${dayKey}`,
        {
          title: `${this.categoryLabel(category)} spike today`,
          body: `Today is ${this.formatAmount(row.total)} (${ratio.toFixed(1)}x your recent average).`,
          data: {
            type: "category_spike_alert",
            category,
            amount: row.total.toFixed(2),
            average: avg.toFixed(2),
          },
        },
        3,
      );
    }
  }

  @Cron("0 0 18 * * *")
  async sendRecurringDueTomorrowReminders() {
    if (!this.messaging) return;

    const templates = await this.db.expenses
      .find({
        isRecurring: true,
        recurringParentId: null,
        deletedAt: null,
        isIncome: false,
      })
      .toArray();
    if (templates.length === 0) return;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const tomorrowKey = this.dateKey(tomorrow);

    const templateIds = templates.map((t) => t._id);

    // Batch fetch the latest instance for EACH template in ONE query
    const latestInstances = await this.db.expenses
      .aggregate<{ _id: string; lastDate: Date }>([
        {
          $match: {
            recurringParentId: { $in: templateIds },
            deletedAt: null,
          },
        },
        {
          $group: {
            _id: "$recurringParentId",
            lastDate: { $max: "$date" },
          },
        },
      ])
      .toArray();

    const lastDateByTemplateId = new Map(
      latestInstances.map((i) => [i._id, i.lastDate]),
    );

    for (const template of templates) {
      const userId = template.userId?.trim();
      if (!userId || !template.recurringRule) continue;

      const lastDate = lastDateByTemplateId.get(template._id);
      const baseDate = new Date(lastDate ?? template.date);
      baseDate.setHours(0, 0, 0, 0);
      const nextDate = this.nextOccurrence(baseDate, template.recurringRule);
      if (!this.isSameDate(nextDate, tomorrow)) continue;

      await this.sendOnceToUser(
        userId,
        `recurring-due:${template._id}:${tomorrowKey}`,
        {
          title: "Recurring bill due tomorrow",
          body: `${template.description} (${this.formatAmount(template.amount)}) is due tomorrow.`,
          data: {
            type: "recurring_due_tomorrow",
            expenseId: template._id,
            amount: template.amount.toFixed(2),
          },
        },
        4,
      );
    }
  }

  @Cron("0 0 */4 * * *")
  async sendBudgetThresholdAlerts() {
    if (!this.messaging) return;

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(
      year,
      month,
      0,
      NOTIFICATION_CONFIG.END_OF_DAY_HOURS,
      NOTIFICATION_CONFIG.END_OF_DAY_MINUTES,
      NOTIFICATION_CONFIG.END_OF_DAY_SECONDS,
      NOTIFICATION_CONFIG.END_OF_DAY_MILLISECONDS,
    );

    const budgets = await this.db.budgets
      .find({ month, year, deletedAt: null })
      .toArray();
    if (budgets.length === 0) return;

    // Collect all user+category combos to query
    const userCategoryPairs = budgets
      .filter((b) => b.allocatedAmount > 0)
      .map((b) => ({ userId: b.userId, category: b.categoryKey }));

    if (userCategoryPairs.length === 0) return;

    // Batch fetch spent amounts for ALL budgets in ONE query
    const spentAmounts = await this.db.expenses
      .aggregate<{ userId: string; category: string; total: number }>([
        {
          $match: {
            $or: userCategoryPairs.map((p) => ({
              userId: p.userId,
              category: p.category,
            })),
            deletedAt: null,
            isIncome: false,
            date: { $gte: monthStart, $lte: monthEnd },
          },
        },
        {
          $group: {
            _id: { userId: "$userId", category: "$category" },
            total: { $sum: "$amount" },
          },
        },
        {
          $project: {
            _id: 0,
            userId: "$_id.userId",
            category: "$_id.category",
            total: 1,
          },
        },
      ])
      .toArray();

    const spentMap = new Map(
      spentAmounts.map((s) => [`${s.userId}:${s.category}`, s.total]),
    );

    for (const budget of budgets) {
      if (budget.allocatedAmount <= 0) continue;

      const spent = spentMap.get(`${budget.userId}:${budget.categoryKey}`) ?? 0;
      const pct = (spent / budget.allocatedAmount) * 100;

      for (const threshold of this.budgetThresholds) {
        if (pct < threshold) continue;
        const sent = await this.sendOnceToUser(
          budget.userId,
          `budget-threshold:${year}-${month}:${budget.categoryKey}:${threshold}`,
          {
            title:
              threshold >= 100
                ? `${this.categoryLabel(budget.categoryKey)} budget exceeded`
                : `${this.categoryLabel(budget.categoryKey)} budget at ${threshold}%`,
            body:
              threshold >= 100
                ? `You've used ${this.formatAmount(spent)} against ${this.formatAmount(budget.allocatedAmount)}.`
                : `You've used ${this.formatAmount(spent)} of ${this.formatAmount(budget.allocatedAmount)}.`,
            data: {
              type: "budget_threshold_alert",
              category: budget.categoryKey,
              threshold: String(threshold),
              spent: spent.toFixed(2),
            },
          },
          45,
        );
        if (sent) break;
      }
    }
  }

  @Cron("0 0 10 * * 1")
  async sendInactiveMemberNudges() {
    if (!this.messaging) return;

    const groups = await this.db.groups.find({ deletedAt: null }).toArray();
    if (groups.length === 0) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.inactiveMemberDays);
    const weekKey = this.isoWeekKey(new Date());
    const groupIds = groups.map((g) => g._id);

    // Batch fetch ALL data in 2 queries
    const [allMembers, recentExpenses] = await Promise.all([
      this.db.groupMembers.find({ groupId: { $in: groupIds } }).toArray(),
      this.db.groupExpenses
        .find({
          groupId: { $in: groupIds },
          deletedAt: null,
          date: { $gte: cutoff },
        })
        .toArray(),
    ]);

    // Index by groupId
    const membersByGroup = new Map<string, GroupMemberDoc[]>();
    const expensesByGroup = new Map<string, GroupExpenseDoc[]>();

    for (const member of allMembers) {
      const existing = membersByGroup.get(member.groupId) ?? [];
      existing.push(member);
      membersByGroup.set(member.groupId, existing);
    }

    for (const expense of recentExpenses) {
      const existing = expensesByGroup.get(expense.groupId) ?? [];
      existing.push(expense);
      expensesByGroup.set(expense.groupId, existing);
    }

    for (const group of groups) {
      const members = membersByGroup.get(group._id) ?? [];
      const groupExpenses = expensesByGroup.get(group._id) ?? [];

      if (members.length === 0) continue;

      const activeMemberIds = new Set<string>();
      for (const expense of groupExpenses) {
        activeMemberIds.add(expense.paidByMemberId);
        for (const share of expense.shares) {
          activeMemberIds.add(share.memberId);
        }
      }

      for (const member of members) {
        const userId = member.userId?.trim();
        if (!userId) continue;
        if (activeMemberIds.has(member._id)) continue;

        await this.sendOnceToUser(
          userId,
          `inactive-member-nudge:${group._id}:${member._id}:${weekKey}`,
          {
            title: `${group.name} misses your updates`,
            body: "Add an expense or settle up this week to keep the group current.",
            data: {
              type: "inactive_member_nudge",
              groupId: group._id,
            },
          },
          10,
        );
      }
    }
  }

  @Cron("0 0 19 * * *")
  async sendMonthEndSettleReminders() {
    if (!this.messaging) return;

    const now = new Date();
    const day = now.getDate();
    if (day < 25) return;

    const monthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
    const groups = await this.db.groups.find({ deletedAt: null }).toArray();
    if (groups.length === 0) return;

    const groupIds = groups.map((g) => g._id);

    // Batch fetch ALL data in 2 queries
    const [allMembers, allExpenses] = await Promise.all([
      this.db.groupMembers.find({ groupId: { $in: groupIds } }).toArray(),
      this.db.groupExpenses
        .find({ groupId: { $in: groupIds }, deletedAt: null })
        .toArray(),
    ]);

    // Index by groupId
    const membersByGroup = new Map<string, GroupMemberDoc[]>();
    const expensesByGroup = new Map<string, GroupExpenseDoc[]>();

    for (const member of allMembers) {
      const existing = membersByGroup.get(member.groupId) ?? [];
      existing.push(member);
      membersByGroup.set(member.groupId, existing);
    }

    for (const expense of allExpenses) {
      const existing = expensesByGroup.get(expense.groupId) ?? [];
      existing.push(expense);
      expensesByGroup.set(expense.groupId, existing);
    }

    for (const group of groups) {
      const members = membersByGroup.get(group._id) ?? [];
      const expenses = expensesByGroup.get(group._id) ?? [];
      if (members.length === 0 || expenses.length === 0) continue;

      const balances = this.computeGroupBalances(members, expenses);
      for (const member of members) {
        const userId = member.userId?.trim();
        if (!userId) continue;

        const net = balances[member._id] ?? 0;
        if (net >= -0.01) continue;

        const amount = Math.abs(net);
        await this.sendOnceToUser(
          userId,
          `month-end-settle:${group._id}:${member._id}:${monthKey}`,
          {
            title: `Best time to settle: ${group.name}`,
            body: `Month-end is near and you owe ${this.formatAmount(amount)}. Settling now keeps balances clean.`,
            data: {
              type: "month_end_settle_reminder",
              groupId: group._id,
              amount: amount.toFixed(2),
            },
          },
          40,
        );
      }
    }
  }

  private initializeFirebase() {
    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const base64Json = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

    if (!rawJson && !base64Json) {
      this.logger.warn(
        "FCM disabled: FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64 is not configured.",
      );
      return;
    }

    try {
      const credentialJson = rawJson
        ? rawJson
        : Buffer.from(base64Json ?? "", "base64").toString("utf8");
      const serviceAccount = JSON.parse(credentialJson) as admin.ServiceAccount;

      if (admin.apps.length === 0) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }

      this.messaging = admin.messaging();
      this.logger.log("FCM notification service enabled.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`FCM initialization failed: ${message}`);
      this.messaging = null;
    }
  }

  private formatAmount(amount: number): string {
    return `₹${amount.toFixed(amount % 1 == 0 ? 0 : 2)}`;
  }

  private categoryLabel(categoryKey: string): string {
    if (!categoryKey) return "Category";
    const words = categoryKey
      .replace(/[_-]/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase());
    return words.join(" ");
  }

  private dateKey(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  private isoWeekKey(date: Date): string {
    const d = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / TIME_CONSTANTS.ONE_DAY_MS + 1) / 7,
    );
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  }

  private isSameDate(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private nextOccurrence(from: Date, rule: string): Date {
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
      default:
        next.setDate(next.getDate() + 1);
        break;
    }
    return next;
  }

  private computeGroupBalances(
    members: GroupMemberDoc[],
    expenses: GroupExpenseDoc[],
  ): Record<string, number> {
    const balances: Record<string, number> = {};
    for (const member of members) {
      balances[member._id] = 0;
    }

    for (const expense of expenses) {
      balances[expense.paidByMemberId] =
        (balances[expense.paidByMemberId] ?? 0) + expense.amount;
      for (const share of expense.shares) {
        balances[share.memberId] =
          (balances[share.memberId] ?? 0) - share.amount;
      }
    }

    return balances;
  }

  private async distinctActiveDeviceUserIds(): Promise<string[]> {
    return this.db.pushDevices.distinct("userId", { disabledAt: null });
  }

  private async hasActiveDevice(userId: string): Promise<boolean> {
    const count = await this.db.pushDevices.countDocuments(
      { userId, disabledAt: null },
      { limit: 1 },
    );
    return count > 0;
  }

  private _numberFromEnv(name: string, fallback: number): number {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }

  private async reserveNotificationSlot(
    key: string,
    type: string,
    userId: string,
    ttlDays: number,
  ): Promise<boolean> {
    try {
      const now = new Date();
      const expiresAt = new Date(now);
      expiresAt.setDate(expiresAt.getDate() + ttlDays);

      await this.db.notificationEvents.insertOne({
        _id: randomUUID(),
        key,
        type,
        userId,
        createdAt: now,
        expiresAt,
      });
      return true;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === DB_ERROR_CODES.MONGO_DUPLICATE_KEY_ERROR) {
        return false;
      }
      throw error;
    }
  }

  private async sendOnceToUser(
    userId: string,
    dedupeKey: string,
    payload: FcmPayload,
    ttlDays = 7,
  ): Promise<boolean> {
    if (!this.messaging) return false;
    if (!userId.trim()) return false;
    if (!(await this.hasActiveDevice(userId))) return false;

    const type = payload.data?.type ?? "generic_notification";
    const key = `${type}:${dedupeKey}:${userId}`;
    const reserved = await this.reserveNotificationSlot(
      key,
      type,
      userId,
      ttlDays,
    );
    if (!reserved) return false;

    await this.sendToUsers([userId], payload);
    return true;
  }

  private async sendToUsers(userIds: string[], payload: FcmPayload) {
    if (!this.messaging) return;

    const uniqueUserIds = Array.from(
      new Set(userIds.filter((id) => id.trim())),
    );
    if (uniqueUserIds.length === 0) return;

    const devices = await this.db.pushDevices
      .find({
        userId: { $in: uniqueUserIds },
        disabledAt: null,
      })
      .project({ token: 1 })
      .toArray();

    const tokens = Array.from(
      new Set(
        devices.map((device) => device.token).filter((t) => t && t.trim()),
      ),
    );
    if (tokens.length === 0) return;

    const staleTokens: string[] = [];

    for (let i = 0; i < tokens.length; i += NOTIFICATION_CONFIG.FCM_BATCH_SIZE) {
      const batch = tokens.slice(i, i + NOTIFICATION_CONFIG.FCM_BATCH_SIZE);
      const response = await this.messaging.sendEachForMulticast({
        tokens: batch,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
        android: {
          priority: "high",
        },
        apns: {
          headers: {
            "apns-priority": "10",
          },
        },
      });

      response.responses.forEach((entry, index) => {
        if (entry.success) return;
        const code = entry.error?.code ?? "";
        if (
          code === "messaging/invalid-registration-token" ||
          code === "messaging/registration-token-not-registered"
        ) {
          staleTokens.push(batch[index]);
        }
      });
    }

    if (staleTokens.length > 0) {
      await this.db.pushDevices.updateMany(
        { token: { $in: staleTokens } },
        { $set: { disabledAt: new Date(), updatedAt: new Date() } },
      );
    }
  }
}
