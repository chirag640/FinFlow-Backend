import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class RegisterDeviceDto {
  @ApiProperty({ description: "FCM device token" })
  @IsString()
  @MinLength(20)
  token: string;

  @ApiPropertyOptional({
    description: "Client platform (android, ios, web, macos, windows, linux)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  platform?: string;
}
