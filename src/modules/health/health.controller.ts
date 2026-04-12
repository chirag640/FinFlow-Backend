import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { RetentionService } from "../../common/services/retention.service";
import { ReceiptStorageService } from "../expenses/receipt-storage.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  FcmHealthResponseDto,
  HealthResponseDto,
  ReceiptsHealthResponseDto,
  RetentionHealthResponseDto,
} from "./dto/health-response.dto";

@ApiTags("System")
@Controller({ path: "health", version: "1" })
export class HealthController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly retention: RetentionService,
    private readonly receiptStorage: ReceiptStorageService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Health check" })
  @ApiOkResponse({ type: HealthResponseDto })
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
  @ApiOkResponse({ type: FcmHealthResponseDto })
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
  @ApiOkResponse({ type: RetentionHealthResponseDto })
  getRetentionPolicy() {
    return {
      status: "ok",
      ...this.retention.getRetentionPolicy(),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get("receipts")
  @ApiOperation({ summary: "Receipt storage health diagnostics" })
  @ApiOkResponse({ type: ReceiptsHealthResponseDto })
  getReceiptHealth() {
    const health = this.receiptStorage.getHealthStatus();
    return {
      status: health.receiptStorageConfigured ? "ok" : "degraded",
      ...health,
      timestamp: new Date().toISOString(),
    };
  }
}
