import { Module, Global } from "@nestjs/common";
import { EncryptionService } from "./encryption.service";
import { RetentionService } from "./retention.service";
import { EmailQueueService } from "./email-queue.service";
import { DatabaseModule } from "../../database/database.module";

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [EncryptionService, RetentionService, EmailQueueService],
  exports: [EncryptionService, RetentionService, EmailQueueService],
})
export class EncryptionModule {}
