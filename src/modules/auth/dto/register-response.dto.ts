import { ApiProperty } from "@nestjs/swagger";
import { AuthUserDto } from "./auth-response.dto";

export class RegisterResponseDto {
  @ApiProperty({
    description: "Whether email verification is required before issuing tokens",
    example: true,
  })
  requiresVerification: boolean;

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;
}
