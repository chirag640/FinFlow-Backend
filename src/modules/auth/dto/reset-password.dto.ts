import { ApiProperty } from "@nestjs/swagger";
import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class ResetPasswordDto {
  @ApiProperty({ example: "jane@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "482910", description: "6-digit reset code" })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiProperty({ example: "NewPassword1", minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^(?=.*[A-Z])(?=.*\d)/, {
    message:
      "Password must include at least one uppercase letter and one number",
  })
  newPassword: string;
}
