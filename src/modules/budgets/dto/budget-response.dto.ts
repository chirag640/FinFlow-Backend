import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class BudgetResponseDto {
  @ApiProperty({ example: "9f3c1a4e-5a59-4ccf-a177-2cd53d0a741a" })
  id: string;

  @ApiProperty({ example: "food" })
  categoryKey: string;

  @ApiProperty({ example: 5000 })
  allocatedAmount: number;

  @ApiProperty({ example: 4 })
  month: number;

  @ApiProperty({ example: 2026 })
  year: number;

  @ApiProperty({ example: false })
  carryForward: boolean;

  @ApiProperty({ example: "6b516f67-f4b4-4ab0-84e8-d7fdd86e4cb8" })
  userId: string;

  @ApiPropertyOptional({ nullable: true, example: "2026-04-11T11:00:00.000Z" })
  deletedAt?: Date | null;

  @ApiProperty({ example: "2026-04-11T10:00:00.000Z" })
  createdAt: Date;

  @ApiProperty({ example: "2026-04-11T10:00:00.000Z" })
  updatedAt: Date;

  @ApiPropertyOptional({ example: 2500 })
  spent?: number;

  @ApiPropertyOptional({ example: 2500 })
  remaining?: number;

  @ApiPropertyOptional({ example: 50 })
  pct?: number;
}
