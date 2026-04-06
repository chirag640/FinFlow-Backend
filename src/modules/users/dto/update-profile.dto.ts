import {
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsUrl,
  IsIn,
  IsNumber,
  Min,
  Max,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDecimalScale } from "../../../common/validators/decimal-scale.validator";

export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: "janedoe",
    description:
      "Unique username: 3-20 chars, lowercase letters/numbers/underscores",
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  @Matches(/^[a-z0-9_]+$/, {
    message:
      "Username can only contain lowercase letters, numbers, and underscores",
  })
  username?: string;

  @ApiPropertyOptional({ example: "Jane Doe" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ example: "https://example.com/avatar.jpg" })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @ApiPropertyOptional({
    example: "USD",
    description: "ISO 4217 currency code",
  })
  @IsOptional()
  @IsString()
  @IsIn(["INR", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "SGD", "AED"])
  currency?: string;

  @ApiPropertyOptional({
    example: 50000,
    description: "Monthly income/budget in chosen currency",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  @IsDecimalScale(2)
  monthlyBudget?: number;
}
