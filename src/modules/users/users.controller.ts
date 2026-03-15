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
import {
  IsHexadecimal,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from "class-validator";
import { UsersService } from "./users.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { CurrentUser } from "../../common/decorators/current-user.decorator";

class UpdatePinDto {
  /** SHA-256 hex hash of the PIN, or null to remove the PIN entirely. */
  @IsOptional()
  @ValidateIf((o) => o.pinHash !== null)
  @IsString()
  @IsHexadecimal()
  @Length(64, 64, {
    message: "pinHash must be a 64-character SHA-256 hex string",
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
  @ApiOperation({ summary: "Set or update app PIN hash (SHA-256)" })
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
