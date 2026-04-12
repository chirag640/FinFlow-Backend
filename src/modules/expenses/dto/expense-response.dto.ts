import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ExpenseResponseDto {
  @ApiProperty({ example: "c2b65c8f-5d93-4e3d-a1a6-0ec44cc3c771" })
  id: string;

  @ApiProperty({ example: 450 })
  amount: number;

  @ApiProperty({ example: "Lunch at Zomato" })
  description: string;

  @ApiProperty({ example: "food" })
  category: string;

  @ApiProperty({ example: "2026-04-11T10:00:00.000Z" })
  date: Date;

  @ApiPropertyOptional({ nullable: true, example: "Client meeting" })
  notes?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "Base64-encoded receipt image payload",
  })
  receiptImageBase64?: string | null;

  @ApiPropertyOptional({ nullable: true, example: "image/jpeg" })
  receiptImageMimeType?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "Remote URL for receipt image in object/blob storage",
    example: "https://cdn.finflow.app/receipts/u1/2026/04/abc123.jpg",
  })
  receiptImageUrl?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "Opaque object/blob storage key for the receipt image",
    example: "receipts/u1/2026/04/abc123.jpg",
  })
  receiptStorageKey?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "OCR text extracted from the receipt",
    example: "TOTAL 450.00\nMerchant: Cafe 95",
  })
  receiptOcrText?: string | null;

  @ApiProperty({ example: false })
  isIncome: boolean;

  @ApiProperty({ example: false })
  isRecurring: boolean;

  @ApiPropertyOptional({ nullable: true, example: "monthly" })
  recurringRule?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "Monthly due day used for recurring bill reminders",
    example: 15,
  })
  recurringDueDay?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: "28f58ee2-a2a8-4e72-9eaf-a9db4897f4f6",
  })
  recurringParentId?: string | null;

  @ApiProperty({ example: "6b516f67-f4b4-4ab0-84e8-d7fdd86e4cb8" })
  userId: string;

  @ApiPropertyOptional({ nullable: true, example: "2026-04-11T11:00:00.000Z" })
  deletedAt?: Date | null;

  @ApiProperty({ example: "2026-04-11T10:00:00.000Z" })
  createdAt: Date;

  @ApiProperty({ example: "2026-04-11T10:00:00.000Z" })
  updatedAt: Date;
}

export class ExpensePageResponseDto {
  @ApiProperty({ type: [ExpenseResponseDto] })
  data: ExpenseResponseDto[];

  @ApiPropertyOptional({
    nullable: true,
    example: "9b7ac6bf-68f2-4f8e-9b6a-a8482e0518d9",
  })
  nextCursor?: string | null;

  @ApiProperty({ example: true })
  hasMore: boolean;

  @ApiPropertyOptional({ example: 142 })
  total?: number;
}

export class ExpenseSummaryResponseDto {
  @ApiProperty({ example: 23450.45 })
  total: number;

  @ApiProperty({ example: 78000 })
  totalIncome: number;

  @ApiProperty({ example: 54549.55 })
  net: number;

  @ApiProperty({
    type: "object",
    additionalProperties: { type: "number" },
    example: { food: 3200, travel: 5000 },
  })
  byCategory: Record<string, number>;

  @ApiProperty({
    type: [Number],
    example: [120, 340, 450, 210, 1200, 560, 420],
  })
  last7DaysSpending: number[];

  @ApiProperty({ example: 35 })
  count: number;

  @ApiProperty({ example: 4 })
  incomeCount: number;
}

export class ExpenseDuplicateCheckResponseDto {
  @ApiProperty({ example: true })
  hasPotentialDuplicates: boolean;

  @ApiProperty({
    type: [ExpenseResponseDto],
    description: "Top duplicate candidates sorted by closest recent date",
  })
  candidates: ExpenseResponseDto[];
}

export class ExpenseBatchOperationResponseDto {
  @ApiProperty({ enum: ["delete", "updateCategory"] })
  action: "delete" | "updateCategory";

  @ApiProperty({ example: 3 })
  processed: number;

  @ApiProperty({ example: 1 })
  skipped: number;

  @ApiProperty({
    type: [String],
    example: [
      "a5f0f875-3d32-4f45-ac97-84d5bf9c4d67",
      "95dc5305-a6c7-4fc1-a117-f3ca6060f31f",
    ],
  })
  ids: string[];
}
