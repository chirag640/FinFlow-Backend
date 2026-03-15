import { IsString, IsUUID, IsOptional, Length } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class VerifyEmailDto {
  @ApiPropertyOptional({
    example: "8c4cbc7f-9c3f-4854-850c-db852a635c5b",
    description: "User ID (sent by client when not authenticated)",
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ example: "482910", description: "6-digit OTP from email" })
  @IsString()
  @Length(6, 6)
  code: string;
}
