import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
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

  @ApiPropertyOptional({
    description: "Base64-encoded receipt image payload",
    maxLength: 2000000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000000)
  receiptImageBase64?: string;

  @ApiPropertyOptional({
    description: "MIME type of the attached receipt image",
    example: "image/jpeg",
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  receiptImageMimeType?: string;

  @ApiPropertyOptional({
    description:
      "Remote URL for receipt image when stored in object/blob storage",
    example: "https://cdn.finflow.app/receipts/u1/2026/04/abc123.jpg",
    maxLength: 2048,
  })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  receiptImageUrl?: string;

  @ApiPropertyOptional({
    description: "Opaque object/blob storage key for the receipt image",
    example: "receipts/u1/2026/04/abc123.jpg",
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  receiptStorageKey?: string;

  @ApiPropertyOptional({
    description: "OCR text extracted from receipt image",
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  receiptOcrText?: string;

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

  @ApiPropertyOptional({
    description: "Monthly due day used for recurring bill reminders",
    minimum: 1,
    maximum: 31,
    example: 15,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  recurringDueDay?: number;
}
