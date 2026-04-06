import { describe, expect, it } from "@jest/globals";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { GroupExpenseQueryDto } from "./group-expense-query.dto";

describe("GroupExpenseQueryDto validation", () => {
  it("rejects non-UUID cursor payloads", async () => {
    const dto = plainToInstance(GroupExpenseQueryDto, {
      cursor: '{"$ne":null}',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === "cursor")).toBe(true);
  });

  it("rejects malicious order and sort values", async () => {
    const dto = plainToInstance(GroupExpenseQueryDto, {
      sortBy: "$where",
      order: "$gt",
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === "sortBy")).toBe(true);
    expect(errors.some((e) => e.property === "order")).toBe(true);
  });

  it("accepts valid safe query options", async () => {
    const dto = plainToInstance(GroupExpenseQueryDto, {
      cursor: "550e8400-e29b-41d4-a716-446655440000",
      sortBy: "amount",
      order: "desc",
      take: 25,
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
