import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
  IsNumber,
  IsBoolean,
  IsIn,
  IsPositive,
  Min,
  ValidateIf,
  ArrayMaxSize,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";

// ── Push DTOs ─────────────────────────────────────────────────────────────────
export class SyncExpenseDto {
  @IsString() id: string;
  // Deleted tombstones carry amount=0; only validate positive for live records.
  @IsNumber()
  @ValidateIf((o: SyncExpenseDto) => !o.deleted)
  @IsPositive()
  amount: number;
  @IsString() description: string;
  @IsString() category: string;
  @IsDateString() date: string;
  @IsOptional() @IsString() notes?: string;
  @IsBoolean() isIncome: boolean;
  @IsBoolean() isRecurring: boolean;
  @IsOptional() @IsString() recurringRule?: string;
  @IsDateString() updatedAt: string;
  @IsBoolean() deleted: boolean;
}

export class SyncBudgetDto {
  @IsString() id: string;
  @IsString() categoryKey: string;
  @IsNumber() @IsPositive() allocatedAmount: number;
  @IsNumber() month: number;
  @IsNumber() year: number;
  @IsBoolean() carryForward: boolean;
  @IsDateString() updatedAt: string;
  @IsBoolean() deleted: boolean;
}

export class SyncPushDto {
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
}

// ── Pull DTOs ─────────────────────────────────────────────────────────────────
export class SyncPullDto {
  @ApiPropertyOptional({
    description: "ISO date string, last sync time. Omit for full sync.",
  })
  @IsOptional()
  @IsDateString()
  since?: string;
}
