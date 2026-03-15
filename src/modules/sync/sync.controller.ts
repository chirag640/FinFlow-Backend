import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SyncService } from "./sync.service";
import { SyncPushDto, SyncPullDto } from "./dto/sync.dto";
import { CurrentUser } from "../../common/decorators/current-user.decorator";

@ApiTags("sync")
@ApiBearerAuth("access-token")
@Controller("sync")
export class SyncController {
  constructor(private svc: SyncService) {}

  @Post("push")
  @ApiOperation({ summary: "Push local changes to server" })
  push(@CurrentUser("id") uid: string, @Body() dto: SyncPushDto) {
    return this.svc.push(uid, dto);
  }

  @Get("pull")
  @ApiOperation({ summary: "Pull server changes since timestamp" })
  pull(@CurrentUser("id") uid: string, @Query() query: SyncPullDto) {
    return this.svc.pull(uid, query.since);
  }
}
