import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class AuthSessionDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ required: false })
  lastUsedAt?: Date;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ required: false, nullable: true })
  ipAddress?: string | null;

  @ApiProperty({ required: false, nullable: true })
  userAgent?: string | null;

  @ApiProperty({ required: false, nullable: true })
  deviceName?: string | null;
}

export class RevokeSessionDto {
  @ApiProperty({ description: "Session ID to revoke" })
  @IsUUID()
  sessionId: string;
}
