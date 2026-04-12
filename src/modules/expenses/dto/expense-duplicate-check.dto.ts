import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { IsDecimalScale } from "../../../common/validators/decimal-scale.validator";

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return Boolean(value);
}

export class ExpenseDuplicateCheckDto {
  @ApiProperty({ example: 450.0 })
  @Transform(({ value }) =>
    typeof value === "string" ? Number.parseFloat(value) : value,
  )
  @IsNumber()
  @IsPositive()
  @IsDecimalScale(2)
  amount: number;

  @ApiProperty({ example: "Lunch at Zomato" })
  @IsString()
  @MaxLength(120)
  description: string;

  @ApiProperty({
    description: "ISO 8601 date string for the candidate transaction",
    example: "2026-04-12T11:00:00.000Z",
  })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({
    description: "How many days around the target date should be scanned",
    default: 3,
    minimum: 0,
    maximum: 30,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : Number.parseInt(String(value), 10),
  )
  @IsInt()
  @Min(0)
  @Max(30)
  lookbackDays?: number = 3;

  @ApiPropertyOptional({
    description: "Restrict duplicate checks to income or expense records",
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  isIncome?: boolean = false;
}
