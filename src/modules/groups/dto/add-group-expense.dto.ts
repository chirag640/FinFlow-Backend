import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsIn,
  IsPositive,
  IsDateString,
  ValidateNested,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";

// ── Custom class-level validator ─────────────────────────────────────────────
/**
 * When splitType is "custom", verifies that the sum of all share amounts
 * equals the top-level expense amount (±0.01 for floating-point tolerance).
 */
function SharesSumMatchesAmount(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "sharesSumMatchesAmount",
      target: (
        object as {
          constructor: new (...args: unknown[]) => unknown;
        }
      ).constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const dto = args.object as AddGroupExpenseDto;
          if (dto.splitType !== "custom") return true;
          const sum = (dto.shares ?? []).reduce((s, sh) => s + sh.amount, 0);
          return Math.abs(sum - dto.amount) <= 0.01;
        },
        defaultMessage(args: ValidationArguments) {
          const dto = args.object as AddGroupExpenseDto;
          const sum = (dto.shares ?? []).reduce((s, sh) => s + sh.amount, 0);
          return `shares sum (${sum}) must equal amount (${dto.amount}) for splitType "custom"`;
        },
      },
    });
  };
}

export class ShareDto {
  @ApiProperty() @IsString() memberId: string;
  @ApiProperty() @IsNumber() @IsPositive() amount: number;
}

export class AddGroupExpenseDto {
  @ApiProperty({ example: 1800.0 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ example: "Hotel booking" })
  @IsString()
  description: string;

  @ApiProperty({ example: "member-id-123" })
  @IsString()
  paidByMemberId: string;

  @ApiProperty({ enum: ["equal", "custom"], default: "equal" })
  @IsIn(["equal", "custom"])
  splitType: string;

  @ApiProperty({ type: [ShareDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShareDto)
  @SharesSumMatchesAmount()
  shares: ShareDto[];

  @ApiProperty({ example: "2024-03-05T12:00:00.000Z" })
  @IsDateString()
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
