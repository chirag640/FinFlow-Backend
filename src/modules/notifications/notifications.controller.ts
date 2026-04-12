import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { NotificationsService } from "../notifications/notifications.service";
import { RegisterDeviceResponseDto } from "./dto/notifications-response.dto";
import { RegisterDeviceDto } from "./dto/register-device.dto";
import { RemoveDeviceDto } from "./dto/remove-device.dto";

@ApiTags("notifications")
@ApiBearerAuth("access-token")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post("devices")
  @ApiOperation({ summary: "Register or refresh FCM device token" })
  @ApiBody({ type: RegisterDeviceDto })
  @ApiCreatedResponse({ type: RegisterDeviceResponseDto })
  registerDevice(
    @CurrentUser("id") userId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.notifications.registerDevice(userId, dto.token, dto.platform);
  }

  @Delete("devices")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Unregister FCM device token" })
  @ApiBody({ type: RemoveDeviceDto })
  @ApiNoContentResponse({ description: "Device token unregistered" })
  unregisterDevice(
    @CurrentUser("id") userId: string,
    @Body() dto: RemoveDeviceDto,
  ) {
    return this.notifications.unregisterDevice(userId, dto.token);
  }
}
