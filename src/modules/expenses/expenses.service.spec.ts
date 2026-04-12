import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ExpensesService } from "./expenses.service";

type AnyDoc = Record<string, any>;

const makeCursor = (
  rows: AnyDoc[],
  onSort?: (spec: Record<string, number>) => void,
) => {
  const cursor: any = {
    sort: jest.fn((spec: Record<string, number>) => {
      onSort?.(spec);
      return cursor;
    }),
    limit: jest.fn(() => cursor),
    toArray: jest.fn(async () => rows),
  };
  return cursor;
};

describe("ExpensesService query hardening", () => {
  let service: ExpensesService;
  let db: any;

  beforeEach(() => {
    db = {
      expenses: {
        find: jest.fn(),
        countDocuments: jest.fn(async () => 1),
      },
    };

    service = new ExpensesService(db);
  });

  it("escapes regex search and falls back to safe sort when payload is malicious", async () => {
    let capturedFilter: AnyDoc | null = null;
    let capturedSort: Record<string, number> | null = null;

    db.expenses.find.mockImplementation((filter: AnyDoc) => {
      capturedFilter = filter;
      return makeCursor(
        [
          {
            _id: "550e8400-e29b-41d4-a716-446655440001",
            description: "ok",
          },
        ],
        (sort) => {
          capturedSort = sort;
        },
      );
    });

    const result = await service.findAll("u1", {
      search: "foo.*$where",
      sortBy: "$where",
      order: "$gt",
      cursor: '{"$gt":""}',
      take: 1,
    } as any);

    expect(capturedFilter?.description?.$regex).toBe("foo\\.\\*\\$where");
    expect(capturedFilter?._id).toBeUndefined();
    expect(capturedSort).toEqual({ date: -1, _id: -1 });
    expect(db.expenses.countDocuments).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(1);
  });

  it("accepts valid cursor and safe sort field", async () => {
    let capturedFilter: AnyDoc | null = null;
    let capturedSort: Record<string, number> | null = null;

    db.expenses.find.mockImplementation((filter: AnyDoc) => {
      capturedFilter = filter;
      return makeCursor(
        [
          {
            _id: "550e8400-e29b-41d4-a716-446655440000",
            description: "ok",
          },
        ],
        (sort) => {
          capturedSort = sort;
        },
      );
    });

    const result = await service.findAll("u1", {
      cursor: "550e8400-e29b-41d4-a716-446655440000",
      sortBy: "amount",
      order: "asc",
      take: 1,
    } as any);

    expect(capturedFilter?._id).toEqual({
      $lt: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(capturedSort).toEqual({ amount: 1, _id: -1 });
    expect(db.expenses.countDocuments).not.toHaveBeenCalled();
    expect(result.total).toBeUndefined();
  });

  it("rejects maxAmount lower than minAmount", async () => {
    await expect(
      service.findAll("u1", {
        minAmount: 300,
        maxAmount: 100,
      } as any),
    ).rejects.toThrow("maxAmount must be greater than or equal to minAmount");
  });

  it("builds duplicate-check filter with escaped exact description", async () => {
    let capturedFilter: AnyDoc | null = null;

    db.expenses.find.mockImplementation((filter: AnyDoc) => {
      capturedFilter = filter;
      return makeCursor([
        {
          _id: "550e8400-e29b-41d4-a716-446655440011",
          amount: 200,
          description: "Rent.*",
          category: "housing",
          date: new Date("2026-04-12T00:00:00.000Z"),
          notes: null,
          isIncome: false,
          isRecurring: false,
          userId: "u1",
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ]);
    });

    const result = await service.checkPotentialDuplicates("u1", {
      amount: 200,
      description: "Rent.*",
      date: "2026-04-12T00:00:00.000Z",
      lookbackDays: 3,
      isIncome: false,
    } as any);

    expect(capturedFilter?.description?.$regex).toBe("^Rent\\.\\*$");
    expect(capturedFilter?.amount).toEqual({ $gte: 199.99, $lte: 200.01 });
    expect(result.hasPotentialDuplicates).toBe(true);
    expect(result.candidates.length).toBe(1);
  });
});
