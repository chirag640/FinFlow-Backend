import {
  IsEmail,
  IsString,
  IsOptional,
  Matches,
  MinLength,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class RegisterDto {
  @ApiProperty({ example: "jane@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: "janedoe",
    description:
      "Unique username: 3-20 chars, lowercase letters/numbers/underscores",
  })
  @IsString()
  @MinLength(3, { message: "Username must be at least 3 characters" })
  @MaxLength(20, { message: "Username must be at most 20 characters" })
  @Matches(/^[a-z0-9_]+$/, {
    message:
      "Username can only contain lowercase letters, numbers, and underscores",
  })
  username: string;

  @ApiPropertyOptional({
    example: "Jane Doe",
    description: "Optional at registration; set during profile setup",
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiProperty({ example: "supersecret", minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^(?=.*[A-Z])(?=.*\d)/, {
    message:
      "Password must include at least one uppercase letter and one number",
  })
  password: string;
}
