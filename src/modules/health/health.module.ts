import { Module } from "@nestjs/common";
import { ExpensesModule } from "../expenses/expenses.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [NotificationsModule, ExpensesModule],
  controllers: [HealthController],
})
export class HealthModule {}
