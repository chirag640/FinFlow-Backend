import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ConflictException } from "@nestjs/common";
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

describe("SyncService chaos scenarios", () => {
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

  it("clears in-flight idempotency record on transient failure and allows safe retry", async () => {
    db.syncPushIdempotency.insertOne.mockResolvedValue({});
    db.expenses.find.mockImplementation(() => makeCursor([]));
    db.expenses.bulkWrite
      .mockRejectedValueOnce(new Error("transient write failure"))
      .mockResolvedValueOnce({ acknowledged: true });

    const payload = {
      expenses: [
        {
          id: "exp-chaos-1",
          amount: 150,
          description: "chaos",
          category: "food",
          date: "2026-03-30T10:00:00.000Z",
          isIncome: false,
          isRecurring: false,
          updatedAt: "2026-03-30T10:00:00.000Z",
          deleted: false,
        },
      ],
      budgets: [],
      goals: [],
    };

    await expect(service.push("u1", payload, "idem-chaos")).rejects.toThrow(
      "transient write failure",
    );

    expect(db.syncPushIdempotency.deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        idempotencyKey: "idem-chaos",
        status: "processing",
      }),
    );
    expect(metrics.recordPushError).toHaveBeenCalledTimes(1);

    const retry = await service.push("u1", payload, "idem-chaos", 1);
    expect(retry.synced.expenses).toBe(1);
    expect(retry.ack.expenses.appliedUpserts).toContain("exp-chaos-1");
    expect(metrics.recordRetry).toHaveBeenCalledWith(1);
    expect(metrics.recordPushSuccess).toHaveBeenCalledTimes(1);
    expect(db.syncPushIdempotency.insertOne).toHaveBeenCalledTimes(2);
    expect(db.syncPushIdempotency.updateOne).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate idempotency key when payload hash differs", async () => {
    db.syncPushIdempotency.insertOne.mockRejectedValue({ code: 11000 });
    db.syncPushIdempotency.findOne.mockResolvedValue({
      userId: "u1",
      idempotencyKey: "idem-conflict",
      requestHash: "other-hash",
      status: "processing",
    });

    const hashSpy = jest
      .spyOn(service as any, "_pushRequestHash")
      .mockReturnValue("hash-a");

    await expect(
      service.push(
        "u1",
        {
          expenses: [],
          budgets: [],
          goals: [],
        },
        "idem-conflict",
      ),
    ).rejects.toThrow(ConflictException);

    expect(metrics.recordIdempotentReplay).not.toHaveBeenCalled();
    hashSpy.mockRestore();
  });

  it("records pull error metrics when a backing collection query fails", async () => {
    db.expenses.find.mockImplementation(() => {
      throw new Error("mongo down");
    });

    await expect(
      service.pull("u1", "2026-03-30T00:00:00.000Z"),
    ).rejects.toThrow("mongo down");

    expect(metrics.recordPullError).toHaveBeenCalledTimes(1);
    expect(metrics.recordPullSuccess).not.toHaveBeenCalled();
  });

  it("handles multi-device write race by accepting newer update and skipping stale retry", async () => {
    const existingSnapshots: AnyDoc[][] = [
      [],
      [
        {
          _id: "exp-shared",
          userId: "u1",
          updatedAt: new Date("2026-03-30T10:00:00.000Z"),
        },
      ],
      [
        {
          _id: "exp-shared",
          userId: "u1",
          updatedAt: new Date("2026-03-30T12:00:00.000Z"),
        },
      ],
    ];

    db.expenses.find.mockImplementation(() =>
      makeCursor(existingSnapshots.shift() ?? []),
    );

    const makePayload = (updatedAt: string, amount: number) => ({
      expenses: [
        {
          id: "exp-shared",
          amount,
          description: "shared-device",
          category: "food",
          date: "2026-03-30T09:00:00.000Z",
          isIncome: false,
          isRecurring: false,
          updatedAt,
          deleted: false,
        },
      ],
      budgets: [],
      goals: [],
    });

    const first = await service.push(
      "u1",
      makePayload("2026-03-30T10:00:00.000Z", 100),
    );
    const second = await service.push(
      "u1",
      makePayload("2026-03-30T11:00:00.000Z", 110),
    );
    const staleRetry = await service.push(
      "u1",
      makePayload("2026-03-30T11:30:00.000Z", 115),
    );

    expect(first.synced.expenses).toBe(1);
    expect(second.synced.expenses).toBe(1);
    expect(staleRetry.synced.expenses).toBe(0);

    expect(second.ack.expenses.appliedUpserts).toContain("exp-shared");
    expect(staleRetry.ack.expenses.skippedUpserts).toContain("exp-shared");

    expect(db.expenses.bulkWrite).toHaveBeenCalledTimes(2);
  });
});
