import { beforeEach, describe, expect, it } from "@jest/globals";
import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import "reflect-metadata";
import { EncryptionService } from "../../common/services/encryption.service";
import { DatabaseService } from "../../database/database.service";
import { SyncMetricsService } from "./sync-metrics.service";
import { SyncService } from "./sync.service";

type IdempotencyDoc = {
  _id: string;
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  status: "processing" | "completed";
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
};

describe("Sync idempotency cleanup integration", () => {
  let docs: IdempotencyDoc[];

  beforeEach(() => {
    const now = Date.now();
    docs = [
      {
        _id: "old-1",
        userId: "u1",
        idempotencyKey: "k1",
        requestHash: "h1",
        status: "completed",
        createdAt: new Date(now - 3_600_000),
        updatedAt: new Date(now - 3_600_000),
        expiresAt: new Date(now - 1_000),
      },
      {
        _id: "old-2",
        userId: "u1",
        idempotencyKey: "k2",
        requestHash: "h2",
        status: "processing",
        createdAt: new Date(now - 3_600_000),
        updatedAt: new Date(now - 3_600_000),
        expiresAt: new Date(now - 500),
      },
      {
        _id: "new-1",
        userId: "u1",
        idempotencyKey: "k3",
        requestHash: "h3",
        status: "completed",
        createdAt: new Date(now - 1_000),
        updatedAt: new Date(now - 1_000),
        expiresAt: new Date(now + 3_600_000),
      },
    ];
  });

  it("purges expired records and updates telemetry counters", async () => {
    const dbMock = {
      expenses: {
        find: () => ({
          sort: () => ({
            limit: () => ({
              toArray: async () => [],
              next: async () => null,
            }),
          }),
          limit: () => ({
            toArray: async () => [],
          }),
          toArray: async () => [],
        }),
      },
      budgets: {
        find: () => ({
          sort: () => ({
            limit: () => ({
              toArray: async () => [],
              next: async () => null,
            }),
          }),
          limit: () => ({
            toArray: async () => [],
          }),
          toArray: async () => [],
        }),
      },
      goals: {
        find: () => ({
          sort: () => ({
            limit: () => ({
              toArray: async () => [],
              next: async () => null,
            }),
          }),
          limit: () => ({
            toArray: async () => [],
          }),
          toArray: async () => [],
        }),
      },
      users: {
        findOne: async () => null,
      },
      syncPushIdempotency: {
        insertOne: async () => ({ acknowledged: true }),
        findOne: async () => null,
        updateOne: async () => ({ matchedCount: 1 }),
        deleteOne: async () => ({ deletedCount: 1 }),
        countDocuments: async (query: { expiresAt?: { $lte: Date } }) => {
          const threshold = query?.expiresAt?.$lte;
          if (!threshold) return docs.length;
          return docs.filter((doc) => doc.expiresAt <= threshold).length;
        },
        deleteMany: async (query: { expiresAt: { $lte: Date } }) => {
          const threshold = query.expiresAt.$lte;
          const before = docs.length;
          docs = docs.filter((doc) => doc.expiresAt > threshold);
          return { deletedCount: before - docs.length };
        },
      },
    };

    @Module({
      providers: [
        SyncService,
        SyncMetricsService,
        { provide: DatabaseService, useValue: dbMock },
        {
          provide: EncryptionService,
          useValue: { decrypt: (value: string) => value },
        },
      ],
    })
    class SyncIdempotencyCleanupIntegrationModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [SyncIdempotencyCleanupIntegrationModule],
    }).compile();

    const syncService = moduleRef.get(SyncService);
    const metrics = moduleRef.get(SyncMetricsService);

    const before = (await syncService.getTelemetry()) as {
      idempotency: { expiredBacklog: number };
    };
    expect(before.idempotency.expiredBacklog).toBe(2);

    await syncService.purgeExpiredIdempotencyRecords();

    const after = (await syncService.getTelemetry()) as {
      idempotency: { expiredBacklog: number };
    };
    expect(after.idempotency.expiredBacklog).toBe(0);
    expect(metrics.snapshot().counters.idempotencyPurged).toBe(2);

    await moduleRef.close();
  });
});
