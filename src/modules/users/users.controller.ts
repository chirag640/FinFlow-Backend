import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { IsOptional, Matches, IsString, ValidateIf } from "class-validator";
import { UsersService } from "./users.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { CurrentUser } from "../../common/decorators/current-user.decorator";

class UpdatePinDto {
  /**
   * PIN hash payload, or null to remove the PIN entirely.
   * Accepts:
   * - Legacy unsalted format: 64-char SHA-256 hex
   * - Current salted format: 32-char hex salt + ':' + 64-char SHA-256 hex
   */
  @IsOptional()
  @ValidateIf((o) => o.pinHash !== null)
  @IsString()
  @Matches(/^(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{32}:[a-fA-F0-9]{64})$/, {
    message:
      "pinHash must be 64-char SHA-256 hex or salted format (32-char hex salt:64-char hex hash)",
  })
  pinHash: string | null;
}

@ApiTags("users")
@ApiBearerAuth("access-token")
@Controller("users")
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get("search")
  @ApiOperation({ summary: "Search users by username prefix (min 2 chars)" })
  @ApiQuery({ name: "username", required: true, type: String, example: "chir" })
  search(@Query("username") username: string) {
    return this.usersService.searchByUsername(username ?? "");
  }

  @Get("me")
  @ApiOperation({ summary: "Get current user profile" })
  getMe(@CurrentUser("id") userId: string) {
    return this.usersService.findById(userId);
  }

  @Patch("me")
  @ApiOperation({ summary: "Update current user profile" })
  updateMe(@CurrentUser("id") userId: string, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Patch("pin")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Set or update app PIN hash (legacy or salted)" })
  updatePin(@CurrentUser("id") userId: string, @Body() dto: UpdatePinDto) {
    return this.usersService.updatePin(userId, dto.pinHash);
  }

  @Delete("me")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Soft-delete account" })
  deleteMe(@CurrentUser("id") userId: string) {
    return this.usersService.deleteAccount(userId);
  }
}
