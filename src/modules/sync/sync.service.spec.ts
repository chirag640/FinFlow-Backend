import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { SyncService } from "./sync.service";

type AnyDoc = Record<string, any>;

const makeCursor = (rows: AnyDoc[]) => ({
  sort() {
    return this;
  },
  limit() {
    return this;
  },
  async toArray() {
    return rows;
  },
  async next() {
    return rows[0] ?? null;
  },
});

describe("SyncService", () => {
  let service: SyncService;
  let db: any;
  let encryption: any;
  let metrics: any;

  beforeEach(() => {
    db = {
      expenses: {
        find: jest.fn(),
        bulkWrite: jest.fn(async () => ({ acknowledged: true })),
      },
      budgets: {
        find: jest.fn(),
        bulkWrite: jest.fn(async () => ({ acknowledged: true })),
      },
      goals: {
        find: jest.fn(),
        bulkWrite: jest.fn(async () => ({ acknowledged: true })),
      },
      users: {
        findOne: jest.fn(),
      },
      syncPushIdempotency: {
        insertOne: jest.fn(),
        findOne: jest.fn(),
        updateOne: jest.fn(),
        deleteOne: jest.fn(),
        countDocuments: jest.fn(async () => 0),
        deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
      },
    };

    encryption = {
      decrypt: jest.fn((v: string) => `dec:${v}`),
    };

    metrics = {
      recordPushSuccess: jest.fn(),
      recordPushError: jest.fn(),
      recordPullSuccess: jest.fn(),
      recordPullError: jest.fn(),
      recordRetry: jest.fn(),
      recordIdempotentReplay: jest.fn(),
      recordIdempotencyHit: jest.fn(),
      recordIdempotencyMiss: jest.fn(),
      recordIdempotencyPurge: jest.fn(),
      snapshot: jest.fn(() => ({ ok: true })),
    };

    service = new SyncService(db, encryption, metrics);
  });

  it("pull uses strict > since boundary and maps response payload", async () => {
    const since = "2026-03-30T10:00:00.000Z";

    db.expenses.find.mockImplementation((query: AnyDoc) => {
      if (query.updatedAt?.$gt) {
        return makeCursor([
          {
            _id: "exp-1",
            amount: 100,
            description: "Lunch",
            category: "food",
            date: new Date("2026-03-30T09:00:00.000Z"),
            notes: null,
            isIncome: false,
            isRecurring: false,
            recurringRule: null,
            userId: "u1",
            updatedAt: new Date("2026-03-30T10:01:00.000Z"),
            deletedAt: null,
          },
        ]);
      }
      return makeCursor([{ updatedAt: new Date("2026-03-30T10:01:00.000Z") }]);
    });

    db.budgets.find.mockImplementation((query: AnyDoc) => {
      if (query.updatedAt?.$gt) {
        return makeCursor([
          {
            _id: "bud-1",
            categoryKey: "food",
            allocatedAmount: 1000,
            month: 3,
            year: 2026,
            carryForward: false,
            userId: "u1",
            updatedAt: new Date("2026-03-30T10:01:00.000Z"),
            deletedAt: null,
          },
        ]);
      }
      return makeCursor([{ updatedAt: new Date("2026-03-30T10:01:00.000Z") }]);
    });

    db.goals.find.mockImplementation((query: AnyDoc) => {
      if (query.updatedAt?.$gt) {
        return makeCursor([
          {
            _id: "goal-1",
            title: "Emergency Fund",
            emoji: "🎯",
            targetAmount: 10000,
            currentAmount: 2000,
            colorIndex: 1,
            userId: "u1",
            updatedAt: new Date("2026-03-30T10:01:00.000Z"),
            deletedAt: null,
          },
        ]);
      }
      return makeCursor([{ updatedAt: new Date("2026-03-30T10:01:00.000Z") }]);
    });

    db.users.findOne.mockResolvedValue({
      _id: "u1",
      name: "encrypted-name",
      email: "user@example.com",
      avatarUrl: null,
      currency: "INR",
      monthlyBudget: 5000,
      emailVerified: true,
      updatedAt: new Date("2026-03-30T10:01:00.000Z"),
    });

    const result = await service.pull("u1", since);

    const expenseDeltaCall = db.expenses.find.mock.calls.find(
      ([query]: [AnyDoc]) => query.updatedAt?.$gt,
    );
    expect(expenseDeltaCall?.[0]?.updatedAt?.$gt?.toISOString()).toBe(since);

    expect(result.expenses[0]).toEqual(
      expect.objectContaining({ id: "exp-1", deleted: false }),
    );
    expect(result.budgets[0]).toEqual(
      expect.objectContaining({ id: "bud-1", deleted: false }),
    );
    expect(result.goals[0]).toEqual(
      expect.objectContaining({ id: "goal-1", deleted: false }),
    );
    expect(result.user).toEqual(
      expect.objectContaining({ id: "u1", name: "dec:encrypted-name" }),
    );
    expect(result.suggestedPullDelayMs).toBe(20_000);
  });

  it("pull short-circuits via watermark for repeated unchanged polls", async () => {
    db.expenses.find.mockImplementation((query: AnyDoc) => {
      if (query.updatedAt?.$gt) {
        return makeCursor([
          {
            _id: "exp-1",
            userId: "u1",
            amount: 100,
            description: "Lunch",
            category: "food",
            date: new Date("2026-03-30T09:00:00.000Z"),
            notes: null,
            isIncome: false,
            isRecurring: false,
            recurringRule: null,
            updatedAt: new Date("2026-03-30T10:01:00.000Z"),
            deletedAt: null,
          },
        ]);
      }
      return makeCursor([{ updatedAt: new Date("2026-03-30T10:01:00.000Z") }]);
    });
    db.budgets.find.mockImplementation((query: AnyDoc) =>
      query.updatedAt?.$gt
        ? makeCursor([])
        : makeCursor([{ updatedAt: new Date("2026-03-30T10:01:00.000Z") }]),
    );
    db.goals.find.mockImplementation((query: AnyDoc) =>
      query.updatedAt?.$gt
        ? makeCursor([])
        : makeCursor([{ updatedAt: new Date("2026-03-30T10:01:00.000Z") }]),
    );
    db.users.findOne.mockResolvedValue({
      _id: "u1",
      name: "enc",
      email: "u1@example.com",
      avatarUrl: null,
      currency: "INR",
      monthlyBudget: 5000,
      emailVerified: true,
      updatedAt: new Date("2026-03-30T10:01:00.000Z"),
    });

    await service.pull("u1", "2026-03-30T10:00:00.000Z");

    const expenseCallsAfterFirst = db.expenses.find.mock.calls.length;
    const budgetCallsAfterFirst = db.budgets.find.mock.calls.length;
    const goalCallsAfterFirst = db.goals.find.mock.calls.length;
    const userCallsAfterFirst = db.users.findOne.mock.calls.length;

    const second = await service.pull("u1", "2026-03-30T11:00:00.000Z");

    expect(second.unchanged).toBe(true);
    expect(second.suggestedPullDelayMs).toBe(90_000);
    expect(db.expenses.find.mock.calls.length).toBe(expenseCallsAfterFirst);
    expect(db.budgets.find.mock.calls.length).toBe(budgetCallsAfterFirst);
    expect(db.goals.find.mock.calls.length).toBe(goalCallsAfterFirst);
    expect(db.users.findOne.mock.calls.length).toBe(userCallsAfterFirst);
  });

  it("push skips foreign and stale records and bulk-writes only valid deltas", async () => {
    db.expenses.find.mockImplementation((query: AnyDoc) => {
      const ids: string[] = query._id.$in;
      const docs = ids
        .map((id) => {
          if (id === "exp-foreign") {
            return {
              _id: id,
              userId: "other-user",
              updatedAt: new Date("2026-03-30T00:00:00.000Z"),
            };
          }
          if (id === "exp-stale") {
            return {
              _id: id,
              userId: "u1",
              updatedAt: new Date("2026-03-30T20:00:00.000Z"),
            };
          }
          return null;
        })
        .filter(Boolean);
      return makeCursor(docs as AnyDoc[]);
    });

    const now = new Date().toISOString();
    const result = await service.push("u1", {
      expenses: [
        {
          id: "exp-foreign",
          amount: 99,
          description: "skip me",
          category: "other",
          date: now,
          isIncome: false,
          isRecurring: false,
          updatedAt: now,
          deleted: false,
        },
        {
          id: "exp-stale",
          amount: 100,
          description: "stale local",
          category: "food",
          date: now,
          isIncome: false,
          isRecurring: false,
          updatedAt: "2026-03-30T10:00:00.000Z",
          deleted: false,
        },
        {
          id: "exp-new",
          amount: 120,
          description: "insert me",
          category: "food",
          date: now,
          notes: "note",
          isIncome: false,
          isRecurring: false,
          recurringRule: undefined,
          updatedAt: now,
          deleted: false,
        },
      ],
      budgets: [],
      goals: [],
    });

    expect(result.synced.expenses).toBe(1);
    expect(result.ack.expenses.skippedUpserts).toEqual(
      expect.arrayContaining(["exp-foreign", "exp-stale"]),
    );
    expect(result.ack.expenses.appliedUpserts).toEqual(["exp-new"]);

    expect(db.expenses.bulkWrite).toHaveBeenCalledTimes(1);
    const ops = db.expenses.bulkWrite.mock.calls[0][0] as Array<AnyDoc>;
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter._id).toBe("exp-new");
  });

  it("returns completed replay from idempotency ledger for duplicate push", async () => {
    db.syncPushIdempotency.insertOne.mockRejectedValue({ code: 11000 });
    db.syncPushIdempotency.findOne.mockResolvedValue({
      userId: "u1",
      idempotencyKey: "idem-1",
      requestHash: "hash-match",
      status: "completed",
      response: {
        synced: { expenses: 1, budgets: 0, goals: 0 },
        ack: {
          expenses: {
            appliedUpserts: ["exp-1"],
            appliedDeletions: [],
            skippedUpserts: [],
            skippedDeletions: [],
          },
          budgets: {
            appliedUpserts: [],
            appliedDeletions: [],
            skippedUpserts: [],
            skippedDeletions: [],
          },
          goals: {
            appliedUpserts: [],
            appliedDeletions: [],
            skippedUpserts: [],
            skippedDeletions: [],
          },
        },
        timestamp: "2026-03-30T00:00:00.000Z",
      },
    });

    const hashSpy = jest
      .spyOn(service as any, "_pushRequestHash")
      .mockReturnValue("hash-match");

    const result = await service.push(
      "u1",
      { expenses: [], budgets: [], goals: [] },
      "idem-1",
      1,
    );

    expect(result.synced.expenses).toBe(1);
    expect(db.expenses.bulkWrite).not.toHaveBeenCalled();
    expect(metrics.recordIdempotentReplay).toHaveBeenCalled();
    expect(metrics.recordRetry).toHaveBeenCalledWith(1);
    hashSpy.mockRestore();
  });

  it("returns unchanged response when no mutation is newer than since", async () => {
    const since = "2026-03-30T10:00:00.000Z";

    db.expenses.find.mockImplementation((query: AnyDoc) => {
      if (query.updatedAt?.$gt) {
        throw new Error("delta query should not execute on unchanged path");
      }
      return makeCursor([{ updatedAt: new Date("2026-03-30T10:00:00.000Z") }]);
    });
    db.budgets.find.mockImplementation((query: AnyDoc) => {
      if (query.updatedAt?.$gt) {
        throw new Error("delta query should not execute on unchanged path");
      }
      return makeCursor([{ updatedAt: new Date("2026-03-30T09:59:59.000Z") }]);
    });
    db.goals.find.mockImplementation((query: AnyDoc) => {
      if (query.updatedAt?.$gt) {
        throw new Error("delta query should not execute on unchanged path");
      }
      return makeCursor([{ updatedAt: new Date("2026-03-30T09:59:58.000Z") }]);
    });

    db.users.findOne.mockResolvedValue({
      _id: "u1",
      name: "enc",
      email: "u1@example.com",
      avatarUrl: null,
      currency: "INR",
      monthlyBudget: 5000,
      emailVerified: true,
      updatedAt: new Date("2026-03-30T09:59:57.000Z"),
    });

    const result = await service.pull("u1", since);
    expect(result.unchanged).toBe(true);
    expect(result.expenses).toHaveLength(0);
    expect(result.budgets).toHaveLength(0);
    expect(result.goals).toHaveLength(0);
    expect(result.user).toBeNull();
    expect(result.suggestedPullDelayMs).toBe(90_000);
  });

  it("exposes telemetry snapshot with idempotency details", async () => {
    db.syncPushIdempotency.countDocuments.mockResolvedValue(7);

    await expect(service.getTelemetry()).resolves.toEqual({
      ok: true,
      idempotency: {
        ttlMs: expect.any(Number),
        expiredBacklog: 7,
      },
      anomalies: [],
    });
  });

  it("reports telemetry anomalies when thresholds are breached", async () => {
    metrics.snapshot.mockReturnValue({
      counters: {
        pushTotal: 40,
        pushErrors: 12,
        pullTotal: 30,
        pullErrors: 7,
        retries: 25,
      },
      staleness: {
        pullStalenessP95Ms: 900_000,
      },
    });
    db.syncPushIdempotency.countDocuments.mockResolvedValue(200);

    const telemetry = await service.getTelemetry();
    const anomalyCodes = telemetry.anomalies.map(
      (a: { code: string }) => a.code,
    );

    expect(anomalyCodes).toEqual(
      expect.arrayContaining([
        "sync_push_error_rate_high",
        "sync_pull_error_rate_high",
        "sync_retry_rate_high",
        "sync_pull_staleness_high",
        "sync_idempotency_backlog_high",
      ]),
    );
  });

  it("rejects unsupported sync version for push and pull", async () => {
    await expect(
      service.push(
        "u1",
        { syncVersion: 2, expenses: [], budgets: [], goals: [] },
        undefined,
        0,
        2,
      ),
    ).rejects.toThrow("Unsupported syncVersion");

    await expect(service.pull("u1", undefined, 2)).rejects.toThrow(
      "Unsupported syncVersion",
    );
  });
});
