import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class RemoveDeviceDto {
  @ApiProperty({ description: "FCM device token to unregister" })
  @IsString()
  @MinLength(20)
  token: string;
}
