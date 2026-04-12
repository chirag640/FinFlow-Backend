import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { IsDecimalScale } from "../../../common/validators/decimal-scale.validator";

export const SYNC_PROTOCOL_VERSION = 1;

// ── Push DTOs ─────────────────────────────────────────────────────────────────
export class SyncExpenseDto {
  @IsString() id: string;
  // Deleted tombstones carry amount=0; only validate positive for live records.
  @IsNumber()
  @ValidateIf((o: SyncExpenseDto) => !o.deleted)
  @IsPositive()
  @IsDecimalScale(2)
  amount: number;
  @MaxLength(120)
  @IsString()
  description: string;
  @MaxLength(64)
  @IsString()
  category: string;
  @IsDateString() date: string;
  @IsOptional()
  @MaxLength(500)
  @IsString()
  notes?: string;
  @IsOptional()
  @MaxLength(2000000)
  @IsString()
  receiptImageBase64?: string;
  @IsOptional()
  @MaxLength(64)
  @IsString()
  receiptImageMimeType?: string;
  @IsOptional()
  @MaxLength(2048)
  @IsUrl({ require_protocol: true })
  receiptImageUrl?: string;
  @IsOptional()
  @MaxLength(256)
  @IsString()
  receiptStorageKey?: string;
  @IsOptional()
  @MaxLength(5000)
  @IsString()
  receiptOcrText?: string;
  @IsBoolean() isIncome: boolean;
  @IsBoolean() isRecurring: boolean;
  @IsOptional() @IsString() recurringRule?: string;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  recurringDueDay?: number;
  @IsDateString() updatedAt: string;
  @IsBoolean() deleted: boolean;
}

export class SyncBudgetDto {
  @IsString() id: string;

  @IsOptional()
  @ValidateIf((o: SyncBudgetDto) => !o.deleted)
  @MaxLength(64)
  @IsString()
  categoryKey?: string;

  @IsNumber()
  @ValidateIf((o: SyncBudgetDto) => !o.deleted)
  @IsPositive()
  @IsDecimalScale(2)
  allocatedAmount: number;

  @IsOptional()
  @ValidateIf((o: SyncBudgetDto) => !o.deleted)
  @IsNumber()
  month?: number;

  @IsOptional()
  @ValidateIf((o: SyncBudgetDto) => !o.deleted)
  @IsNumber()
  year?: number;

  @IsOptional()
  @ValidateIf((o: SyncBudgetDto) => !o.deleted)
  @IsBoolean()
  carryForward?: boolean;

  @IsDateString() updatedAt: string;
  @IsBoolean() deleted: boolean;
}

export class SyncGoalDto {
  @IsString() id: string;

  @IsOptional()
  @ValidateIf((o: SyncGoalDto) => !o.deleted)
  @MaxLength(120)
  @IsString()
  title?: string;

  @IsOptional()
  @ValidateIf((o: SyncGoalDto) => !o.deleted)
  @MaxLength(16)
  @IsString()
  emoji?: string;

  @IsOptional()
  @ValidateIf((o: SyncGoalDto) => !o.deleted)
  @IsNumber()
  @IsPositive()
  @IsDecimalScale(2)
  targetAmount?: number;

  @IsOptional()
  @ValidateIf((o: SyncGoalDto) => !o.deleted)
  @IsNumber()
  @Min(0)
  @IsDecimalScale(2)
  currentAmount?: number;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @ValidateIf((o: SyncGoalDto) => !o.deleted)
  @IsInt()
  @Min(0)
  colorIndex?: number;

  @IsDateString() updatedAt: string;
  @IsBoolean() deleted: boolean;
}

export class SyncPushDto {
  @ApiPropertyOptional({
    description: "Sync payload contract version",
    default: SYNC_PROTOCOL_VERSION,
    minimum: SYNC_PROTOCOL_VERSION,
    maximum: SYNC_PROTOCOL_VERSION,
  })
  @IsOptional()
  @IsInt()
  @Min(SYNC_PROTOCOL_VERSION)
  @Max(SYNC_PROTOCOL_VERSION)
  syncVersion?: number = SYNC_PROTOCOL_VERSION;

  @ApiPropertyOptional({ type: [SyncExpenseDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500, { message: "Cannot sync more than 500 expenses at once" })
  @ValidateNested({ each: true })
  @Type(() => SyncExpenseDto)
  expenses?: SyncExpenseDto[];

  @ApiPropertyOptional({ type: [SyncBudgetDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500, { message: "Cannot sync more than 500 budgets at once" })
  @ValidateNested({ each: true })
  @Type(() => SyncBudgetDto)
  budgets?: SyncBudgetDto[];

  @ApiPropertyOptional({ type: [SyncGoalDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500, { message: "Cannot sync more than 500 goals at once" })
  @ValidateNested({ each: true })
  @Type(() => SyncGoalDto)
  goals?: SyncGoalDto[];
}

// ── Pull DTOs ─────────────────────────────────────────────────────────────────
export class SyncPullDto {
  @ApiPropertyOptional({
    description: "Sync payload contract version",
    default: SYNC_PROTOCOL_VERSION,
    minimum: SYNC_PROTOCOL_VERSION,
    maximum: SYNC_PROTOCOL_VERSION,
  })
  @IsOptional()
  @IsInt()
  @Min(SYNC_PROTOCOL_VERSION)
  @Max(SYNC_PROTOCOL_VERSION)
  syncVersion?: number = SYNC_PROTOCOL_VERSION;

  @ApiPropertyOptional({
    description: "ISO date string, last sync time. Omit for full sync.",
  })
  @IsOptional()
  @IsDateString()
  since?: string;
}
