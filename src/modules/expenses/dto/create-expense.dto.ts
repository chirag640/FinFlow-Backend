import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import { IsDecimalScale } from "../../../common/validators/decimal-scale.validator";

export class CreateExpenseDto {
  @ApiPropertyOptional({
    description:
      "Client-generated UUID v4 — server uses it as _id to prevent sync duplicates",
  })
  @IsOptional()
  @IsUUID("4")
  id?: string;

  @ApiProperty({ example: 450.0 })
  @IsNumber()
  @IsPositive()
  @IsDecimalScale(2)
  amount: number;

  @ApiProperty({ example: "Lunch at Zomato" })
  @IsString()
  @MaxLength(120)
  description: string;

  @ApiProperty({ example: "food" })
  @IsString()
  category: string;

  @ApiProperty({ example: "2024-03-05T12:00:00.000Z" })
  @IsDateString()
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isIncome?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @ApiPropertyOptional({ enum: ["daily", "weekly", "monthly", "yearly"] })
  @IsOptional()
  @IsIn(["daily", "weekly", "monthly", "yearly"])
  recurringRule?: string;
}
