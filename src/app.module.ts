import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";

import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { ExpensesModule } from "./modules/expenses/expenses.module";
import { GroupsModule } from "./modules/groups/groups.module";
import { BudgetsModule } from "./modules/budgets/budgets.module";
import { SyncModule } from "./modules/sync/sync.module";
import { InvestmentsModule } from "./modules/investments/investments.module";
import { HealthModule } from "./modules/health/health.module";
import { EncryptionModule } from "./common/services/encryption.module";

import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import {
  HttpExceptionFilter,
  AllExceptionsFilter,
} from "./common/filters/http-exception.filter";
import { MongoExceptionFilter } from "./common/filters/mongo-exception.filter";
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
    BudgetsModule,
    SyncModule,
    InvestmentsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useClass: MongoExceptionFilter },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
