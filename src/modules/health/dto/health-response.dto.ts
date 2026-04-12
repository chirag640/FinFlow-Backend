import { ApiProperty } from "@nestjs/swagger";

export class HealthResponseDto {
  @ApiProperty({ example: "ok" })
  status: string;

  @ApiProperty({ example: "2026-04-11T12:25:00.000Z" })
  timestamp: string;

  @ApiProperty({ example: 5231.24 })
  uptime: number;
}

export class FcmHealthResponseDto {
  @ApiProperty({ example: "ok" })
  status: string;

  @ApiProperty({ example: true })
  fcmConfigured: boolean;

  @ApiProperty({ example: "2026-04-11T12:25:00.000Z" })
  timestamp: string;
}

export class RetentionHealthResponseDto {
  @ApiProperty({ example: "ok" })
  status: string;

  @ApiProperty({ example: 30 })
  softDeleteRetentionDays: number;

  @ApiProperty({ example: 500 })
  permanentDeleteBatchSize: number;

  @ApiProperty({ example: "Daily at 3 AM UTC" })
  purgeSchedule: string;

  @ApiProperty({ example: "2026-04-11T12:25:00.000Z" })
  timestamp: string;
}

export class ReceiptsHealthResponseDto {
  @ApiProperty({ example: "ok" })
  status: string;

  @ApiProperty({ enum: ["local", "s3"], example: "s3" })
  receiptStorageProvider: "local" | "s3";

  @ApiProperty({ example: true })
  receiptStorageConfigured: boolean;

  @ApiProperty({ example: true })
  signedReadUrls: boolean;

  @ApiProperty({ example: true })
  s3BucketConfigured: boolean;

  @ApiProperty({ example: "2026-04-11T12:25:00.000Z" })
  timestamp: string;
}
