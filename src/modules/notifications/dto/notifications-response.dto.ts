import { ApiProperty } from "@nestjs/swagger";

export class RegisterDeviceResponseDto {
  @ApiProperty({ example: true })
  registered: boolean;
}
