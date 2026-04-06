import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class ExpenseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID("4")
  cursor?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value))
  take?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @ApiPropertyOptional({
    description: "ISO 8601 date string, from",
    example: "2024-01-01T00:00:00.000Z",
  })
  @IsOptional()
  @IsDateString({}, { message: "from must be a valid ISO 8601 date string" })
  from?: string;

  @ApiPropertyOptional({
    description: "ISO 8601 date string, to",
    example: "2024-12-31T23:59:59.999Z",
  })
  @IsOptional()
  @IsDateString({}, { message: "to must be a valid ISO 8601 date string" })
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({
    enum: ["date", "amount", "createdAt"],
    default: "date",
  })
  @IsOptional()
  @IsIn(["date", "amount", "createdAt"])
  sortBy?: string = "date";

  @ApiPropertyOptional({ enum: ["asc", "desc"], default: "desc" })
  @IsOptional()
  @IsIn(["asc", "desc"])
  order?: "asc" | "desc" = "desc";
}
