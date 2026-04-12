import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  IsDefined,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from "class-validator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import {
  UserProfileResponseDto,
  UserSearchResultDto,
  VerifyPinResponseDto,
} from "./dto/users-response.dto";
import { UsersService } from "./users.service";

class UpdatePinDto {
  /**
   * PIN hash payload, or null to remove the PIN entirely.
   * Accepts:
   * - Legacy unsalted format: 64-char SHA-256 hex
   * - Current salted format: 32-char hex salt + ':' + 64-char SHA-256 hex
   */
  @ApiPropertyOptional({
    nullable: true,
    description:
      "PIN hash payload or null to clear PIN; accepts legacy 64-char hash or salted format",
    example:
      "5f4dcc3b5aa765d61d8327deb882cf99:5e884898da28047151d0e56f8dc6292773603d0d6aabbdd16a...",
  })
  @IsDefined({ message: "pinHash is required (use null to clear PIN)" })
  @ValidateIf((o) => o.pinHash !== null)
  @IsString()
  @Matches(/^(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{32}:[a-fA-F0-9]{64})$/, {
    message:
      "pinHash must be 64-char SHA-256 hex or salted format (32-char hex salt:64-char hex hash)",
  })
  pinHash: string | null;
}

class VerifyPinDto {
  @ApiProperty({
    description: "Numeric PIN to verify (4-8 digits)",
    example: "1234",
  })
  @IsString()
  @Matches(/^\d{4,8}$/, { message: "pin must be 4 to 8 digits" })
  pin: string;
}

class DeleteAccountDto {
  @ApiProperty({
    description: "Current account password confirmation for deletion",
    example: "Secret123",
  })
  @IsString()
  @MinLength(8, {
    message: "Current password must be at least 8 characters",
  })
  currentPassword: string;
}

@ApiTags("users")
@ApiBearerAuth("access-token")
@Controller("users")
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get("search")
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: "Search users by username prefix (min 2 chars)" })
  @ApiQuery({ name: "username", required: true, type: String, example: "chir" })
  @ApiOkResponse({ status: 200, type: [UserSearchResultDto] })
  search(@Query("username") username: string) {
    return this.usersService.searchByUsername(username?.trim() ?? "");
  }

  @Get("me")
  @ApiOperation({ summary: "Get current user profile" })
  @ApiOkResponse({ status: 200, type: UserProfileResponseDto })
  getMe(@CurrentUser("id") userId: string) {
    return this.usersService.findById(userId);
  }

  @Patch("me")
  @ApiOperation({ summary: "Update current user profile" })
  @ApiBody({ type: UpdateProfileDto })
  @ApiOkResponse({ status: 200, type: UserProfileResponseDto })
  updateMe(@CurrentUser("id") userId: string, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Patch("pin")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Set or update app PIN hash (legacy or salted)" })
  @ApiBody({ type: UpdatePinDto })
  @ApiNoContentResponse({ description: "PIN metadata updated" })
  updatePin(@CurrentUser("id") userId: string, @Body() dto: UpdatePinDto) {
    return this.usersService.updatePin(userId, dto.pinHash);
  }

  @Post("pin/verify")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: "Verify app PIN with server lockout enforcement" })
  @ApiBody({ type: VerifyPinDto })
  @ApiCreatedResponse({ type: VerifyPinResponseDto })
  verifyPin(@CurrentUser("id") userId: string, @Body() dto: VerifyPinDto) {
    return this.usersService.verifyPin(userId, dto.pin);
  }

  @Delete("me")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Soft-delete account" })
  @ApiBody({ type: DeleteAccountDto })
  @ApiNoContentResponse({
    description: "Account deleted and related sessions revoked",
  })
  deleteMe(@CurrentUser("id") userId: string, @Body() dto: DeleteAccountDto) {
    return this.usersService.deleteAccount(userId, dto.currentPassword);
  }
}
