import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

export class GroupExpenseQueryDto {
  @ApiPropertyOptional({ description: "Cursor for pagination" })
  @IsOptional()
  @IsUUID("4")
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value))
  take?: number = 20;

  @ApiPropertyOptional({
    enum: ["date", "amount", "createdAt"],
    default: "date",
    description: "Field to sort by",
  })
  @IsOptional()
  @IsIn(["date", "amount", "createdAt"])
  sortBy?: "date" | "amount" | "createdAt" = "date";

  @ApiPropertyOptional({
    enum: ["asc", "desc"],
    default: "desc",
    description: "Sort order",
  })
  @IsOptional()
  @IsIn(["asc", "desc"])
  order?: "asc" | "desc" = "desc";
}
