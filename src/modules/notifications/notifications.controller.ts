import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { NotificationsService } from "../notifications/notifications.service";
import { RegisterDeviceDto } from "./dto/register-device.dto";
import { RemoveDeviceDto } from "./dto/remove-device.dto";

@ApiTags("notifications")
@ApiBearerAuth("access-token")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post("devices")
  @ApiOperation({ summary: "Register or refresh FCM device token" })
  registerDevice(
    @CurrentUser("id") userId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.notifications.registerDevice(userId, dto.token, dto.platform);
  }

  @Delete("devices")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Unregister FCM device token" })
  unregisterDevice(
    @CurrentUser("id") userId: string,
    @Body() dto: RemoveDeviceDto,
  ) {
    return this.notifications.unregisterDevice(userId, dto.token);
  }
}
