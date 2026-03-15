import { ApiProperty } from "@nestjs/swagger";

export class AuthUserDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() username: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) avatarUrl: string | null;
  @ApiProperty() role: string;
  @ApiProperty() currency: string;
  @ApiProperty() emailVerified: boolean;
  @ApiProperty({ nullable: true }) monthlyBudget: number | null;
}

export class AuthResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty() expiresIn: number; // seconds
  @ApiProperty({ type: AuthUserDto }) user: AuthUserDto;
}
