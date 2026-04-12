import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from "class-validator";

export class ExpenseBatchOperationDto {
  @ApiProperty({ enum: ["delete", "updateCategory"] })
  @IsIn(["delete", "updateCategory"])
  action: "delete" | "updateCategory";

  @ApiProperty({
    type: [String],
    description: "Expense IDs to mutate in one operation",
    example: [
      "a5f0f875-3d32-4f45-ac97-84d5bf9c4d67",
      "95dc5305-a6c7-4fc1-a117-f3ca6060f31f",
    ],
  })
  @Type(() => String)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID("4", { each: true })
  ids: string[];

  @ApiPropertyOptional({
    description:
      "Required when action is updateCategory. Uses the canonical category key.",
    example: "food",
  })
  @ValidateIf((dto) => dto.action === "updateCategory")
  @IsString()
  @MaxLength(64)
  category?: string;
}
