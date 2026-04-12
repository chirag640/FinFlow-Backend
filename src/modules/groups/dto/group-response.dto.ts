import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class GroupMemberResponseDto {
  @ApiProperty({ example: "39ce53c4-f2f2-48bc-89ee-d5f52a825129" })
  id: string;

  @ApiProperty({ example: "Jane Doe" })
  name: string;

  @ApiPropertyOptional({ nullable: true, example: "janedoe" })
  username?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: "6b516f67-f4b4-4ab0-84e8-d7fdd86e4cb8",
  })
  userId?: string | null;
}

export class GroupExpenseShareResponseDto {
  @ApiProperty({ example: "39ce53c4-f2f2-48bc-89ee-d5f52a825129" })
  memberId: string;

  @ApiProperty({ example: 450 })
  amount: number;
}

export class GroupExpenseResponseDto {
  @ApiProperty({ example: "bd43b1bf-97ce-4e41-9c8c-c57f9bd6f866" })
  id: string;

  @ApiProperty({ example: "7f9ef61e-3f80-4952-8e95-4b3e5fe865f0" })
  groupId: string;

  @ApiProperty({ example: 1800 })
  amount: number;

  @ApiProperty({ example: "Hotel booking" })
  description: string;

  @ApiProperty({ example: "39ce53c4-f2f2-48bc-89ee-d5f52a825129" })
  paidByMemberId: string;

  @ApiProperty({ example: "equal" })
  splitType: string;

  @ApiProperty({ type: [GroupExpenseShareResponseDto] })
  shares: GroupExpenseShareResponseDto[];

  @ApiPropertyOptional({ nullable: true, example: "Paid via UPI" })
  note?: string | null;

  @ApiProperty({ example: "2026-04-11T10:00:00.000Z" })
  date: Date;

  @ApiProperty({ example: false })
  isSettlement: boolean;
}

export class GroupResponseDto {
  @ApiProperty({ example: "7f9ef61e-3f80-4952-8e95-4b3e5fe865f0" })
  id: string;

  @ApiProperty({ example: "Goa Trip 2026" })
  name: string;

  @ApiProperty({ example: "🏖️" })
  emoji: string;

  @ApiPropertyOptional({ nullable: true, example: "Friends trip" })
  description?: string | null;

  @ApiProperty({ example: "6b516f67-f4b4-4ab0-84e8-d7fdd86e4cb8" })
  ownerId: string;

  @ApiProperty({ example: "2026-04-11T10:00:00.000Z" })
  createdAt: Date;

  @ApiProperty({ example: "2026-04-11T10:00:00.000Z" })
  updatedAt: Date;

  @ApiProperty({ type: [GroupMemberResponseDto] })
  members: GroupMemberResponseDto[];
}

export class GroupListResponseDto extends GroupResponseDto {
  @ApiProperty({ example: 12 })
  expenseCount: number;
}

export class GroupDetailResponseDto extends GroupResponseDto {
  @ApiProperty({ type: [GroupExpenseResponseDto] })
  expenses: GroupExpenseResponseDto[];

  @ApiProperty({ example: 12 })
  expenseCount: number;
}

export class GroupSettlementsItemDto {
  @ApiProperty({ example: "39ce53c4-f2f2-48bc-89ee-d5f52a825129" })
  from: string;

  @ApiProperty({ example: "fda93b47-8304-42c0-bec8-995f5e96f6e5" })
  to: string;

  @ApiProperty({ example: 450 })
  amount: number;
}

export class GroupSettlementsResponseDto {
  @ApiProperty({
    type: "object",
    additionalProperties: { type: "number" },
    example: {
      "39ce53c4-f2f2-48bc-89ee-d5f52a825129": -450,
      "fda93b47-8304-42c0-bec8-995f5e96f6e5": 450,
    },
  })
  balances: Record<string, number>;

  @ApiProperty({ type: [GroupSettlementsItemDto] })
  settlements: GroupSettlementsItemDto[];

  @ApiProperty({ type: [GroupMemberResponseDto] })
  members: GroupMemberResponseDto[];
}

export class GroupExpensePageResponseDto {
  @ApiProperty({ type: [GroupExpenseResponseDto] })
  data: GroupExpenseResponseDto[];

  @ApiPropertyOptional({
    nullable: true,
    example: "bd43b1bf-97ce-4e41-9c8c-c57f9bd6f866",
  })
  nextCursor?: string | null;

  @ApiProperty({ example: true })
  hasMore: boolean;

  @ApiProperty({ example: 34 })
  total: number;
}

export class GroupSettlementDisputeResponseDto {
  @ApiProperty({ example: "open" })
  status: "open" | "resolved";

  @ApiProperty({ example: "Amount mismatch" })
  reason: string;

  @ApiPropertyOptional({
    nullable: true,
    example: "Please verify transfer screenshot",
  })
  note?: string | null;

  @ApiProperty({ example: "2026-04-11T10:00:00.000Z" })
  disputedAt: Date;

  @ApiProperty({ example: "6b516f67-f4b4-4ab0-84e8-d7fdd86e4cb8" })
  disputedByUserId: string;

  @ApiPropertyOptional({ nullable: true, example: "2026-04-11T12:00:00.000Z" })
  resolvedAt?: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    example: "6b516f67-f4b4-4ab0-84e8-d7fdd86e4cb8",
  })
  resolvedByUserId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: "Owner verified and resolved",
  })
  resolutionNote?: string | null;
}

export class GroupSettlementAuditResponseDto {
  @ApiProperty({ example: "95f655f8-9728-4eef-8ac7-2ec0d479af02" })
  id: string;

  @ApiProperty({ example: "7f9ef61e-3f80-4952-8e95-4b3e5fe865f0" })
  groupId: string;

  @ApiProperty({ example: "bd43b1bf-97ce-4e41-9c8c-c57f9bd6f866" })
  settlementExpenseId: string;

  @ApiProperty({ example: "39ce53c4-f2f2-48bc-89ee-d5f52a825129" })
  fromMemberId: string;

  @ApiProperty({ example: "fda93b47-8304-42c0-bec8-995f5e96f6e5" })
  toMemberId: string;

  @ApiProperty({ example: 450 })
  amount: number;

  @ApiProperty({ example: "2026-04-11T10:00:00.000Z" })
  settledAt: Date;

  @ApiProperty({ example: "6b516f67-f4b4-4ab0-84e8-d7fdd86e4cb8" })
  recordedByUserId: string;

  @ApiProperty({ example: "recorded" })
  status: "recorded" | "disputed" | "resolved";

  @ApiPropertyOptional({
    type: GroupSettlementDisputeResponseDto,
    nullable: true,
  })
  dispute?: GroupSettlementDisputeResponseDto | null;

  @ApiProperty({ example: "2026-04-11T10:00:00.000Z" })
  createdAt: Date;

  @ApiProperty({ example: "2026-04-11T10:00:00.000Z" })
  updatedAt: Date;
}

export class GroupSettlementAuditTrailResponseDto {
  @ApiProperty({ example: 2 })
  total: number;

  @ApiProperty({ type: [GroupSettlementAuditResponseDto] })
  data: GroupSettlementAuditResponseDto[];
}

export class SettleUpResponseDto extends GroupExpenseResponseDto {
  @ApiProperty({ example: "95f655f8-9728-4eef-8ac7-2ec0d479af02" })
  settlementAuditId: string;
}
