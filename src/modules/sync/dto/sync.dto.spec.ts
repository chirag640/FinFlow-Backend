import { describe, expect, it } from "@jest/globals";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { SYNC_PROTOCOL_VERSION, SyncPullDto, SyncPushDto } from "./sync.dto";

describe("Sync DTO contract", () => {
  it("accepts default syncVersion for push payloads", async () => {
    const dto = plainToInstance(SyncPushDto, {
      expenses: [],
      budgets: [],
      goals: [],
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.syncVersion).toBe(SYNC_PROTOCOL_VERSION);
  });

  it("rejects unsupported syncVersion in pull query", async () => {
    const dto = plainToInstance(SyncPullDto, {
      syncVersion: SYNC_PROTOCOL_VERSION + 1,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const versionError = errors.find((e) => e.property === "syncVersion");
    expect(versionError).toBeDefined();
  });

  it("rejects oversize expense notes in push payload", async () => {
    const dto = plainToInstance(SyncPushDto, {
      syncVersion: SYNC_PROTOCOL_VERSION,
      expenses: [
        {
          id: "exp-1",
          amount: 100,
          description: "Coffee",
          category: "food",
          date: "2026-03-31T00:00:00.000Z",
          notes: "x".repeat(501),
          isIncome: false,
          isRecurring: false,
          updatedAt: "2026-03-31T00:00:00.000Z",
          deleted: false,
        },
      ],
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
