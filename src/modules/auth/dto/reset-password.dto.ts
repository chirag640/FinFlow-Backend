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

  @ApiProperty({ example: "482910", description: "6-digit numeric code" })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: "Code must be exactly 6 digits" })
  code: string;

  @ApiProperty({ example: "NewPassword1", minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      "Password must include lowercase, uppercase, and numeric characters",
  })
  newPassword: string;
}
