import { Module } from "@nestjs/common";
import { GroupsController } from "./groups.controller";
import { GroupsService } from "./groups.service";
import { EncryptionService } from "../../common/services/encryption.service";

@Module({
  controllers: [GroupsController],
  providers: [GroupsService, EncryptionService],
})
export class GroupsModule {}
