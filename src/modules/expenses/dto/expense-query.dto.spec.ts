import { describe, expect, it } from "@jest/globals";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ExpenseQueryDto } from "./expense-query.dto";

describe("ExpenseQueryDto validation", () => {
  it("rejects non-UUID cursor payloads", async () => {
    const dto = plainToInstance(ExpenseQueryDto, {
      cursor: '{"$gt":""}',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === "cursor")).toBe(true);
  });

  it("rejects malicious sort field", async () => {
    const dto = plainToInstance(ExpenseQueryDto, {
      sortBy: "$where",
      order: "desc",
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === "sortBy")).toBe(true);
  });

  it("accepts valid safe query options", async () => {
    const dto = plainToInstance(ExpenseQueryDto, {
      cursor: "550e8400-e29b-41d4-a716-446655440000",
      sortBy: "createdAt",
      order: "asc",
      search: "groceries",
      category: "food",
      take: 20,
      minAmount: 10,
      maxAmount: 499.99,
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects negative minAmount", async () => {
    const dto = plainToInstance(ExpenseQueryDto, {
      minAmount: -1,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === "minAmount")).toBe(true);
  });
});
