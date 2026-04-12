import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from "class-validator";

export class CreateReceiptUploadIntentDto {
  @ApiPropertyOptional({
    description: "Receipt image MIME type",
    example: "image/jpeg",
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  mimeType?: string;
}

export class ReceiptUploadIntentResponseDto {
  @ApiProperty({
    description: "Endpoint where multipart upload should be sent",
    example: "https://api.example.com/api/v1/expenses/receipts/upload",
  })
  uploadUrl: string;

  @ApiProperty({ example: "POST" })
  method: string;

  @ApiProperty({
    description: "Opaque object/blob storage key for the uploaded receipt",
    example: "receipts/2026/04/6cc7f0f4d4e3486b9fda8f27a8ec56f8.jpg",
  })
  receiptStorageKey: string;

  @ApiProperty({
    description: "Absolute URL that can be used for preview/rendering",
    example:
      "https://api.example.com/api/v1/expenses/receipts/file/cmVjZWlwdHMvMjAyNi8wNC82Y2M3ZjBmNGQ0ZTM0ODZiOWZkYThmMjdhOGVjNTZmOC5qcGc",
  })
  receiptImageUrl: string;

  @ApiProperty({
    description: "ISO timestamp when this upload intent expires",
    example: "2026-04-12T11:30:00.000Z",
  })
  expiresAt: string;

  @ApiProperty({
    description: "HMAC signature that authorizes this upload intent",
    example: "f6d2c9fbdc6bf0fc99c87a5cb4e3f79da8d5d995f7106f39dcba9f95f63a92d7",
  })
  signature: string;

  @ApiPropertyOptional({ example: "image/jpeg", nullable: true })
  receiptImageMimeType?: string | null;
}

export class UploadReceiptRequestDto {
  @ApiProperty({
    type: "string",
    format: "binary",
    description: "Receipt image binary payload",
  })
  file: unknown;

  @ApiProperty({
    description: "Storage key obtained from upload-intent endpoint",
    example: "receipts/2026/04/6cc7f0f4d4e3486b9fda8f27a8ec56f8.jpg",
  })
  @IsString()
  @MaxLength(256)
  receiptStorageKey: string;

  @ApiProperty({
    description: "Intent expiry timestamp from upload-intent endpoint",
    example: "2026-04-12T11:30:00.000Z",
  })
  @IsDateString()
  expiresAt: string;

  @ApiProperty({
    description: "Intent signature from upload-intent endpoint",
    example: "f6d2c9fbdc6bf0fc99c87a5cb4e3f79da8d5d995f7106f39dcba9f95f63a92d7",
  })
  @IsString()
  @Length(64, 64)
  signature: string;

  @ApiPropertyOptional({ example: "image/jpeg", maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  mimeType?: string;
}

export class UploadReceiptResponseDto {
  @ApiProperty({
    description: "Storage key where receipt is persisted",
    example: "receipts/2026/04/6cc7f0f4d4e3486b9fda8f27a8ec56f8.jpg",
  })
  receiptStorageKey: string;

  @ApiProperty({
    description: "Absolute URL that can be stored with expense metadata",
    example:
      "https://api.example.com/api/v1/expenses/receipts/file/cmVjZWlwdHMvMjAyNi8wNC82Y2M3ZjBmNGQ0ZTM0ODZiOWZkYThmMjdhOGVjNTZmOC5qcGc",
  })
  receiptImageUrl: string;

  @ApiPropertyOptional({ example: "image/jpeg", nullable: true })
  receiptImageMimeType?: string | null;
}
