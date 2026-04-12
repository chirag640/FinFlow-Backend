import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class UserSearchResultDto {
  @ApiProperty({ example: "0f46f803-f15e-4a89-b6c4-2c730edf4589" })
  id: string;

  @ApiProperty({ example: "janedoe" })
  username: string;

  @ApiProperty({ example: "Jane Doe" })
  name: string;
}

export class UserProfileResponseDto {
  @ApiProperty({ example: "0f46f803-f15e-4a89-b6c4-2c730edf4589" })
  id: string;

  @ApiProperty({ example: "jane@example.com" })
  email: string;

  @ApiProperty({ example: "janedoe" })
  username: string;

  @ApiProperty({ example: "Jane Doe" })
  name: string;

  @ApiPropertyOptional({
    nullable: true,
    example: "https://example.com/avatar.jpg",
  })
  avatarUrl?: string | null;

  @ApiProperty({ example: "USER" })
  role: string;

  @ApiProperty({ example: "INR" })
  currency: string;

  @ApiProperty({ example: true })
  emailVerified: boolean;

  @ApiPropertyOptional({ nullable: true, example: 50000 })
  monthlyBudget?: number | null;

  @ApiPropertyOptional({
    description: "Whether app PIN is configured for this account",
    example: true,
  })
  hasPin?: boolean;
}

export class VerifyPinResponseDto {
  @ApiProperty({ example: false })
  valid: boolean;

  @ApiPropertyOptional({
    description: "Remaining attempts before lockout",
    example: 3,
  })
  remainingAttempts?: number;

  @ApiPropertyOptional({
    nullable: true,
    description: "ISO timestamp until which PIN checks are locked",
    example: "2026-04-11T11:50:00.000Z",
  })
  lockedUntil?: string | null;
}
