import {
  IsInt,
  IsNumber,
  IsString,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  IsPositive,
  IsUUID,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateBudgetDto {
  @ApiPropertyOptional({
    description: "Client-generated UUID v4 — used as _id for sync ID parity",
  })
  @IsOptional()
  @IsUUID("4")
  id?: string;

  @ApiProperty({ example: "food" })
  @IsString()
  categoryKey: string;

  @ApiProperty({ example: 5000 })
  @IsNumber()
  @IsPositive()
  allocatedAmount: number;

  @ApiProperty({ example: 3, description: "1-12" })
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ example: 2024 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  carryForward?: boolean;
}
