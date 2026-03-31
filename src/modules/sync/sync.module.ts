import { Module } from "@nestjs/common";
import { EncryptionService } from "../../common/services/encryption.service";
import { SyncMetricsService } from "./sync-metrics.service";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";

@Module({
  controllers: [SyncController],
  providers: [SyncService, SyncMetricsService, EncryptionService],
  exports: [SyncMetricsService],
})
export class SyncModule {}
