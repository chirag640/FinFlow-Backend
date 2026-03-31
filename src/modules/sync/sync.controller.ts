import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { RolesGuard } from "../../common/guards/roles.guard";
import { SyncPullDto, SyncPushDto } from "./dto/sync.dto";
import { SyncService } from "./sync.service";

@ApiTags("sync")
@ApiBearerAuth("access-token")
@Controller("sync")
export class SyncController {
  constructor(private svc: SyncService) {}

  @Post("push")
  @ApiOperation({ summary: "Push local changes to server" })
  push(
    @CurrentUser("id") uid: string,
    @Body() dto: SyncPushDto,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Headers("x-sync-retry-count") retryCountRaw?: string,
  ) {
    const retryCount = Number.parseInt(retryCountRaw ?? "0", 10);
    return this.svc.push(
      uid,
      dto,
      idempotencyKey,
      Number.isFinite(retryCount) ? retryCount : 0,
    );
  }

  @Get("pull")
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  @ApiOperation({ summary: "Pull server changes since timestamp" })
  pull(@CurrentUser("id") uid: string, @Query() query: SyncPullDto) {
    return this.svc.pull(uid, query.since);
  }

  @Get("telemetry")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  @ApiOperation({ summary: "Sync telemetry and SLO snapshot" })
  telemetry() {
    return this.svc.getTelemetry();
  }
}
