import { Module } from "@nestjs/common";
import { EncryptionService } from "../../common/services/encryption.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { GroupsController } from "./groups.controller";
import { GroupsService } from "./groups.service";

@Module({
  imports: [NotificationsModule],
  controllers: [GroupsController],
  providers: [GroupsService, EncryptionService],
})
export class GroupsModule {}
