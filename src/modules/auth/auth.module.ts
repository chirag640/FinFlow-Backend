import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { MailerModule } from "@nestjs-modules/mailer";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { EncryptionService } from "../../common/services/encryption.service";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({}),
    MailerModule.forRootAsync({
      useFactory: () => {
        // Use env vars for SMTP; fall through gracefully when not configured
        const hasSmtp = !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
        return {
          transport: hasSmtp
            ? {
                host: process.env.SMTP_HOST ?? "smtp.gmail.com",
                port: Number(process.env.SMTP_PORT ?? 465),
                secure: (process.env.SMTP_SECURE ?? "true") === "true",
                connectionTimeout: Number(
                  process.env.SMTP_CONNECTION_TIMEOUT_MS ?? 10_000,
                ),
                greetingTimeout: Number(
                  process.env.SMTP_GREETING_TIMEOUT_MS ?? 10_000,
                ),
                socketTimeout: Number(
                  process.env.SMTP_SOCKET_TIMEOUT_MS ?? 20_000,
                ),
                auth: {
                  user: process.env.SMTP_USER,
                  pass: process.env.SMTP_PASS,
                },
              }
            : { sendmail: true }, // stub transport — emails log to console in dev
          defaults: {
            from:
              process.env.EMAIL_FROM ??
              `"FinFlow" <${process.env.SMTP_USER ?? "noreply@finflow.app"}>`,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, EncryptionService],
  exports: [AuthService],
})
export class AuthModule {}
