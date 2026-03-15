import { Module } from "@nestjs/common";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";
import { EncryptionService } from "../../common/services/encryption.service";

@Module({
  controllers: [SyncController],
  providers: [SyncService, EncryptionService],
})
export class SyncModule {}
