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
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";

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

  @IsOptional()
  @ValidateIf((o: SyncBudgetDto) => !o.deleted)
  @IsString()
  categoryKey?: string;

  @IsNumber()
  @ValidateIf((o: SyncBudgetDto) => !o.deleted)
  @IsPositive()
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
  @IsString()
  title?: string;

  @IsOptional()
  @ValidateIf((o: SyncGoalDto) => !o.deleted)
  @IsString()
  emoji?: string;

  @IsOptional()
  @ValidateIf((o: SyncGoalDto) => !o.deleted)
  @IsNumber()
  @IsPositive()
  targetAmount?: number;

  @IsOptional()
  @ValidateIf((o: SyncGoalDto) => !o.deleted)
  @IsNumber()
  @Min(0)
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
    description: "ISO date string, last sync time. Omit for full sync.",
  })
  @IsOptional()
  @IsDateString()
  since?: string;
}
