import { IsOptional, IsString, IsUUID, MinLength, MaxLength, ValidateIf } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class AddMemberDto {
  @ApiPropertyOptional({ description: 'UUID of existing user', format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId?: string;

  @ApiPropertyOptional({ description: 'Name for new member', minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ValidateIf((o) => !o.userId && !o.name)
  validate() {
    throw new Error('Either userId or name must be provided');
  }
}
