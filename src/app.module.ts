import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";

import { EncryptionModule } from "./common/services/encryption.module";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BudgetsModule } from "./modules/budgets/budgets.module";
import { ExpensesModule } from "./modules/expenses/expenses.module";
import { GroupsModule } from "./modules/groups/groups.module";
import { HealthModule } from "./modules/health/health.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { SyncModule } from "./modules/sync/sync.module";
import { UsersModule } from "./modules/users/users.module";

import {
  AllExceptionsFilter,
  HttpExceptionFilter,
} from "./common/filters/http-exception.filter";
import { MongoExceptionFilter } from "./common/filters/mongo-exception.filter";
import { AppThrottlerGuard } from "./common/guards/app-throttler.guard";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
    DatabaseModule,
    EncryptionModule,
    AuthModule,
    UsersModule,
    ExpensesModule,
    GroupsModule,
    NotificationsModule,
    BudgetsModule,
    SyncModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useClass: MongoExceptionFilter },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
