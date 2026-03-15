import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNumber,
  IsPositive,
  IsIn,
  IsDateString,
  IsOptional,
  IsUUID,
  MaxLength,
  Min,
  Max,
} from "class-validator";
import { InvestmentType } from "../../../database/database.types";

const INVESTMENT_TYPES: InvestmentType[] = [
  "mutualFund",
  "fixedDeposit",
  "recurringDeposit",
  "gold",
  "realEstate",
  "stock",
];

export class CreateInvestmentDto {
  @ApiPropertyOptional({ description: "Client-generated UUID for sync dedup" })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ enum: INVESTMENT_TYPES, example: "mutualFund" })
  @IsIn(INVESTMENT_TYPES)
  type: InvestmentType;

  @ApiProperty({ example: "Axis Bluechip Fund" })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiProperty({
    description: "Total amount invested / principal",
    example: 50000,
  })
  @IsNumber()
  @IsPositive()
  investedAmount: number;

  @ApiProperty({ description: "Current market value", example: 58000 })
  @IsNumber()
  @Min(0)
  currentValue: number;

  @ApiProperty({ example: "2023-01-15" })
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional({ example: "2026-01-15" })
  @IsOptional()
  @IsDateString()
  maturityDate?: string;

  @ApiPropertyOptional({
    description: "Annual interest rate % for FD/RD",
    example: 7.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  interestRate?: number;

  @ApiPropertyOptional({
    description: "Units (MF), grams (gold), shares (stock)",
    example: 150.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({
    description: "Purchase price per unit/gram/share",
    example: 320.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  purchasePrice?: number;

  @ApiPropertyOptional({
    description: "Current price per unit/gram/share",
    example: 385.0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  currentPrice?: number;

  @ApiPropertyOptional({ example: "SIP of ₹5000/month started Jan 2023" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
