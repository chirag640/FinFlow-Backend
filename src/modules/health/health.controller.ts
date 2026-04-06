import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { NotificationsService } from "../notifications/notifications.service";
import { RetentionService } from "../../common/services/retention.service";

@ApiTags("System")
@Controller({ path: "health", version: "1" })
export class HealthController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly retention: RetentionService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Health check" })
  @ApiResponse({ status: 200, description: "System is operational" })
  getHealth() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Public()
  @Get("fcm")
  @ApiOperation({ summary: "Firebase Cloud Messaging health check" })
  @ApiResponse({ status: 200, description: "Returns FCM configuration status" })
  getFcmHealth() {
    return {
      status: "ok",
      ...this.notifications.getHealthStatus(),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get("retention")
  @ApiOperation({ summary: "Data retention policy information" })
  @ApiResponse({
    status: 200,
    description: "Returns soft-delete retention policy",
  })
  getRetentionPolicy() {
    return {
      status: "ok",
      ...this.retention.getRetentionPolicy(),
      timestamp: new Date().toISOString(),
    };
  }
}
