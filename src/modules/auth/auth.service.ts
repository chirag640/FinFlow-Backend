import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { MailerService } from "@nestjs-modules/mailer";
import { randomUUID, randomInt } from "crypto";
import * as bcrypt from "bcrypt";
import * as nodemailer from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import { DatabaseService } from "../../database/database.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { RefreshTokenDoc, UserDoc } from "../../database/database.types";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { AuthResponseDto, AuthUserDto } from "./dto/auth-response.dto";
import { AuthSessionDto } from "./dto/session.dto";

type SessionMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceName?: string | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private db: DatabaseService,
    private jwtService: JwtService,
    private mailer: MailerService,
    private encryption: EncryptionService,
  ) {}

  // ── Register ────────────────────────────────────────────────────────────────
  async register(
    dto: RegisterDto,
  ): Promise<{ requiresVerification: true; user: AuthUserDto }> {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim().toLowerCase();

    const [existingEmail, existingUsername] = await Promise.all([
      this.db.users.findOne({ email }),
      this.db.users.findOne({ username }),
    ]);
    if (existingEmail?.emailVerified) {
      throw new ConflictException("Email already in use");
    }

    if (existingUsername && existingUsername._id !== existingEmail?._id) {
      throw new ConflictException("Username already taken");
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const displayName = dto.name?.trim() || email.split("@")[0];
    const { code, hash, expiresAt } = await this.generateOtp();

    const now = new Date();

    if (existingEmail && !existingEmail.emailVerified) {
      await this.db.users.updateOne(
        { _id: existingEmail._id },
        {
          $set: {
            email,
            username,
            usernameUpdatedAt: now,
            name: this.encryption.encrypt(displayName),
            passwordHash,
            otpCode: hash,
            otpExpiresAt: expiresAt,
            updatedAt: now,
            deletedAt: null,
          },
        },
      );

      this.sendVerificationEmail(email, displayName, code).catch((error) => {
        this.logger.error(
          `Background OTP send failed for ${email}`,
          error instanceof Error ? error.stack : undefined,
        );
      });

      return {
        requiresVerification: true,
        user: {
          id: existingEmail._id,
          email,
          username,
          name: displayName,
          avatarUrl: existingEmail.avatarUrl ?? null,
          role: existingEmail.role,
          currency: existingEmail.currency,
          emailVerified: false,
          monthlyBudget: existingEmail.monthlyBudget ?? 0,
        },
      };
    }

    const user: UserDoc = {
      _id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      email,
      username,
      usernameUpdatedAt: now,
      name: this.encryption.encrypt(displayName),
      passwordHash,
      role: "USER",
      currency: "INR",
      monthlyBudget: 0,
      emailVerified: false,
      otpCode: hash,
      otpExpiresAt: expiresAt,
    };
    await this.db.users.insertOne(user);

    this.sendVerificationEmail(email, displayName, code).catch((error) => {
      this.logger.error(
        `Background OTP send failed for ${email}`,
        error instanceof Error ? error.stack : undefined,
      );
    });

    // Do NOT issue tokens until email is verified — tokens are returned by
    // verifyEmail() once the user proves ownership of their address.
    return {
      requiresVerification: true,
      user: {
        id: user._id,
        email: user.email,
        username: user.username ?? "",
        name: displayName,
        avatarUrl: null,
        role: user.role,
        currency: user.currency,
        emailVerified: false,
        monthlyBudget: 0,
      },
    };
  }

  // ── Login ───────────────────────────────────────────────────────────────────
  async login(
    dto: LoginDto,
    sessionMeta?: SessionMeta,
  ): Promise<AuthResponseDto> {
    const user = await this.db.users.findOne({
      email: dto.email,
      deletedAt: null,
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException("Invalid credentials");

    if (!user.emailVerified) {
      const { code, hash, expiresAt } = await this.generateOtp();
      await this.db.users.updateOne(
        { _id: user._id },
        {
          $set: {
            otpCode: hash,
            otpExpiresAt: expiresAt,
            updatedAt: new Date(),
          },
        },
      );
      this.sendVerificationEmail(
        user.email,
        this.encryption.decrypt(user.name),
        code,
      ).catch((error) => {
        this.logger.error(
          `Background OTP send failed for ${user.email}`,
          error instanceof Error ? error.stack : undefined,
        );
      });

      throw new ForbiddenException({
        message: "Email not verified. A new OTP has been sent.",
        code: "EMAIL_NOT_VERIFIED",
        userId: user._id,
      });
    }

    return this.issueTokens(user, { sessionMeta });
  }

  // ── Verify Email ─────────────────────────────────────────────────────────────
  async verifyEmail(
    userId: string,
    code: string,
    sessionMeta?: SessionMeta,
  ): Promise<AuthResponseDto> {
    const user = await this.db.users.findOne({ _id: userId, deletedAt: null });
    if (!user) throw new UnauthorizedException("User not found");
    if (user.emailVerified) return this.issueTokens(user, { sessionMeta });

    if (!user.otpCode || !user.otpExpiresAt) {
      throw new BadRequestException("No pending OTP — request a new one.");
    }
    if (new Date() > new Date(user.otpExpiresAt)) {
      throw new BadRequestException("OTP expired — request a new one.");
    }

    const valid = await bcrypt.compare(code, user.otpCode);
    if (!valid) throw new BadRequestException("Incorrect OTP");

    await this.db.users.updateOne(
      { _id: userId },
      {
        $set: {
          emailVerified: true,
          otpCode: null,
          otpExpiresAt: null,
          updatedAt: new Date(),
        },
      },
    );

    const verified = (await this.db.users.findOne({ _id: userId }))!;
    return this.issueTokens(verified, { sessionMeta });
  }

  // ── Resend OTP ───────────────────────────────────────────────────────────────
  async resendOtp(userId: string): Promise<void> {
    const user = await this.db.users.findOne({ _id: userId, deletedAt: null });
    if (!user) throw new UnauthorizedException("User not found");
    if (user.emailVerified)
      throw new BadRequestException("Email already verified");

    if (user.otpExpiresAt) {
      const sentAt = new Date(user.otpExpiresAt).getTime() - 10 * 60_000;
      if (Date.now() - sentAt < 60_000) {
        throw new BadRequestException(
          "Wait a minute before requesting another code",
        );
      }
    }

    const { code, hash, expiresAt } = await this.generateOtp();
    await this.db.users.updateOne(
      { _id: userId },
      {
        $set: { otpCode: hash, otpExpiresAt: expiresAt, updatedAt: new Date() },
      },
    );
    await this.sendVerificationEmail(
      user.email,
      this.encryption.decrypt(user.name),
      code,
    );
  }

  // ── Forgot / Reset Password ───────────────────────────────────────────────
  async forgotPassword(email: string): Promise<void> {
    const user = await this.db.users.findOne({ email, deletedAt: null });
    // Prevent account enumeration: always return success.
    if (!user || !user.passwordHash) return;

    const now = Date.now();
    if (user.passwordResetExpiresAt) {
      const lastSentAt =
        new Date(user.passwordResetExpiresAt).getTime() - 10 * 60_000;
      if (now - lastSentAt < 60_000) {
        throw new BadRequestException(
          "Wait a minute before requesting another reset code",
        );
      }
    }

    const { code, hash, expiresAt } = await this.generateOtp();
    await this.db.users.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordResetCode: hash,
          passwordResetExpiresAt: expiresAt,
          updatedAt: new Date(),
        },
      },
    );

    await this.sendPasswordResetEmail(
      user.email,
      this.encryption.decrypt(user.name),
      code,
    );
  }

  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.db.users.findOne({ email, deletedAt: null });
    if (!user || !user.passwordResetCode || !user.passwordResetExpiresAt) {
      throw new BadRequestException("Invalid or expired reset code");
    }

    if (new Date() > new Date(user.passwordResetExpiresAt)) {
      throw new BadRequestException("Reset code expired");
    }

    const valid = await bcrypt.compare(code, user.passwordResetCode);
    if (!valid) throw new BadRequestException("Invalid or expired reset code");

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.db.users.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash,
          passwordResetCode: null,
          passwordResetExpiresAt: null,
          updatedAt: new Date(),
        },
      },
    );

    // Invalidate all sessions after password reset.
    await this.db.refreshTokens.deleteMany({ userId: user._id });
  }

  // ── Refresh ─────────────────────────────────────────────────────────────────
  async refresh(
    refreshToken: string,
    sessionMeta?: SessionMeta,
  ): Promise<AuthResponseDto> {
    const stored = await this.db.refreshTokens.findOne({ token: refreshToken });
    if (!stored || new Date() > new Date(stored.expiresAt)) {
      if (stored) await this.db.refreshTokens.deleteOne({ _id: stored._id });
      throw new UnauthorizedException("Refresh token expired or invalid");
    }

    const user = await this.db.users.findOne({ _id: stored.userId });
    if (!user || user.deletedAt) {
      await this.db.refreshTokens.deleteOne({ _id: stored._id });
      throw new UnauthorizedException("Account no longer active");
    }

    // Rotate on the same session ID so clients can consistently manage sessions.
    return this.issueTokens(user, {
      oldRefreshToken: refreshToken,
      existingSessionId: stored._id,
      sessionMeta: {
        ipAddress: sessionMeta?.ipAddress ?? stored.ipAddress ?? null,
        userAgent: sessionMeta?.userAgent ?? stored.userAgent ?? null,
        deviceName:
          this.deriveDeviceName(sessionMeta?.userAgent ?? stored.userAgent) ??
          stored.deviceName ??
          null,
      },
    });
  }

  // ── Logout ──────────────────────────────────────────────────────────────────
  async logout(refreshToken: string): Promise<void> {
    await this.db.refreshTokens.deleteMany({ token: refreshToken });
  }

  async listSessions(userId: string): Promise<AuthSessionDto[]> {
    const now = new Date();
    const rows = await this.db.refreshTokens
      .find({ userId, expiresAt: { $gt: now } })
      .sort({ lastUsedAt: -1, createdAt: -1 })
      .toArray();

    return rows.map((s) => ({
      id: s._id,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      ipAddress: s.ipAddress ?? null,
      userAgent: s.userAgent ?? null,
      deviceName: s.deviceName ?? null,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.db.refreshTokens.deleteOne({
      _id: sessionId,
      userId,
    });
    if (result.deletedCount === 0) {
      throw new NotFoundException("Session not found");
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  private signAccess(user: UserDoc): string {
    return this.jwtService.sign(
      { sub: user._id, email: user.email },
      {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN ?? "1d",
      },
    );
  }

  private async generateOtp(): Promise<{
    code: string;
    hash: string;
    expiresAt: Date;
  }> {
    const code = randomInt(100000, 1000000).toString();
    const hash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    return { code, hash, expiresAt };
  }

  private async sendVerificationEmail(
    to: string,
    name: string,
    code: string,
  ): Promise<void> {
    // Always log OTP in development so testing works without real email delivery
    if (process.env.NODE_ENV !== "production") {
      this.logger.log(
        `\n${"─".repeat(50)}\n📧  OTP for ${to}  →  ${code}\n${"─".repeat(50)}`,
      );
    }
    const smtpReady = this.hasSmtpCredentials();
    if (!smtpReady) {
      const message = "SMTP is not configured. Unable to deliver OTP email.";
      if (process.env.NODE_ENV === "production") {
        this.logger.error(message);
        throw new ServiceUnavailableException(
          "Email service is unavailable. Please contact support.",
        );
      }
      this.logger.warn(
        `${message} Returning without sending email (non-production).`,
      );
      return;
    }

    try {
      const payload = {
        to,
        subject: "FinFlow — Verify your email",
        html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                    max-width:480px;margin:0 auto;padding:40px 24px;background:#ffffff;
                    border-radius:12px;">
          <h1 style="font-size:28px;font-weight:800;color:#0f172a;margin:0 0 8px;">
            ₹ FinFlow
          </h1>
          <p style="font-size:16px;color:#64748b;margin:0 0 32px;">
            Hi ${name}, thanks for signing up!
          </p>
          <p style="font-size:15px;color:#1e293b;margin:0 0 16px;">
            Enter this code in the app to verify your email address:
          </p>
          <div style="background:#f1f5f9;border-radius:12px;padding:24px;
                      text-align:center;margin-bottom:24px;">
            <span style="font-size:40px;font-weight:800;letter-spacing:12px;
                         color:#1B4FD8;font-family:monospace;">${code}</span>
          </div>
          <p style="font-size:13px;color:#94a3b8;margin:0;">
            This code expires in <strong>10 minutes</strong>.
            If you didn't create a FinFlow account, you can safely ignore this email.
          </p>
        </div>
      `,
      };
      await this.mailer.sendMail(payload);
    } catch (error) {
      this.logger.error(
        `Failed to send verification OTP email to ${to}`,
        error instanceof Error ? error.stack : undefined,
      );
      const fallbackOk = await this.tryStartTlsFallback({
        to,
        subject: "FinFlow — Verify your email",
        html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                    max-width:480px;margin:0 auto;padding:40px 24px;background:#ffffff;
                    border-radius:12px;">
          <h1 style="font-size:28px;font-weight:800;color:#0f172a;margin:0 0 8px;">
            ₹ FinFlow
          </h1>
          <p style="font-size:16px;color:#64748b;margin:0 0 32px;">
            Hi ${name}, thanks for signing up!
          </p>
          <p style="font-size:15px;color:#1e293b;margin:0 0 16px;">
            Enter this code in the app to verify your email address:
          </p>
          <div style="background:#f1f5f9;border-radius:12px;padding:24px;
                      text-align:center;margin-bottom:24px;">
            <span style="font-size:40px;font-weight:800;letter-spacing:12px;
                         color:#1B4FD8;font-family:monospace;">${code}</span>
          </div>
          <p style="font-size:13px;color:#94a3b8;margin:0;">
            This code expires in <strong>10 minutes</strong>.
            If you didn't create a FinFlow account, you can safely ignore this email.
          </p>
        </div>
      `,
      });
      if (fallbackOk) return;
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException(
          "Email service is temporarily unavailable. Please try again.",
        );
      }
    }
  }

  private async sendPasswordResetEmail(
    to: string,
    name: string,
    code: string,
  ): Promise<void> {
    if (process.env.NODE_ENV !== "production") {
      this.logger.log(
        `\n${"─".repeat(50)}\n🔐  RESET OTP for ${to}  →  ${code}\n${"─".repeat(50)}`,
      );
    }
    const smtpReady = this.hasSmtpCredentials();
    if (!smtpReady) {
      const message =
        "SMTP is not configured. Unable to deliver password reset email.";
      if (process.env.NODE_ENV === "production") {
        this.logger.error(message);
        throw new ServiceUnavailableException(
          "Email service is unavailable. Please contact support.",
        );
      }
      this.logger.warn(
        `${message} Returning without sending email (non-production).`,
      );
      return;
    }

    try {
      const payload = {
        to,
        subject: "FinFlow — Reset your password",
        html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                    max-width:480px;margin:0 auto;padding:40px 24px;background:#ffffff;
                    border-radius:12px;">
          <h1 style="font-size:28px;font-weight:800;color:#0f172a;margin:0 0 8px;">
            ₹ FinFlow
          </h1>
          <p style="font-size:16px;color:#64748b;margin:0 0 32px;">
            Hi ${name}, use this code to reset your password.
          </p>
          <div style="background:#f1f5f9;border-radius:12px;padding:24px;
                      text-align:center;margin-bottom:24px;">
            <span style="font-size:40px;font-weight:800;letter-spacing:12px;
                         color:#1B4FD8;font-family:monospace;">${code}</span>
          </div>
          <p style="font-size:13px;color:#94a3b8;margin:0;">
            This code expires in <strong>10 minutes</strong>. If you didn't request a password reset,
            you can safely ignore this email.
          </p>
        </div>
      `,
      };
      await this.mailer.sendMail(payload);
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${to}`,
        error instanceof Error ? error.stack : undefined,
      );
      const fallbackOk = await this.tryStartTlsFallback({
        to,
        subject: "FinFlow — Reset your password",
        html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                    max-width:480px;margin:0 auto;padding:40px 24px;background:#ffffff;
                    border-radius:12px;">
          <h1 style="font-size:28px;font-weight:800;color:#0f172a;margin:0 0 8px;">
            ₹ FinFlow
          </h1>
          <p style="font-size:16px;color:#64748b;margin:0 0 32px;">
            Hi ${name}, use this code to reset your password.
          </p>
          <div style="background:#f1f5f9;border-radius:12px;padding:24px;
                      text-align:center;margin-bottom:24px;">
            <span style="font-size:40px;font-weight:800;letter-spacing:12px;
                         color:#1B4FD8;font-family:monospace;">${code}</span>
          </div>
          <p style="font-size:13px;color:#94a3b8;margin:0;">
            This code expires in <strong>10 minutes</strong>. If you didn't request a password reset,
            you can safely ignore this email.
          </p>
        </div>
      `,
      });
      if (fallbackOk) return;
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException(
          "Email service is temporarily unavailable. Please try again.",
        );
      }
    }
  }

  private hasSmtpCredentials(): boolean {
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();
    return Boolean(user && pass);
  }

  private async tryStartTlsFallback(payload: {
    to: string;
    subject: string;
    html: string;
  }): Promise<boolean> {
    try {
      const host = process.env.SMTP_HOST ?? "smtp.gmail.com";
      const user = process.env.SMTP_USER?.trim();
      const pass = process.env.SMTP_PASS?.trim();
      if (!user || !pass) return false;

      const fallbackTransport: SMTPTransport.Options = {
        host,
        port: Number(process.env.SMTP_FALLBACK_PORT ?? 587),
        secure: false,
        requireTLS: true,
        connectionTimeout: Number(
          process.env.SMTP_CONNECTION_TIMEOUT_MS ?? 10_000,
        ),
        greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS ?? 10_000),
        socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS ?? 20_000),
        auth: { user, pass },
      };
      const transporter = nodemailer.createTransport(fallbackTransport);

      await transporter.sendMail({
        from:
          process.env.EMAIL_FROM ??
          `"FinFlow" <${process.env.SMTP_USER ?? "noreply@finflow.app"}>`,
        ...payload,
      });
      await transporter.close();
      this.logger.log(
        `OTP email delivered via STARTTLS fallback to ${payload.to}`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `SMTP STARTTLS fallback failed for ${payload.to}`,
        err instanceof Error ? err.stack : undefined,
      );
      return false;
    }
  }

  private async issueTokens(
    user: UserDoc,
    opts?: {
      oldRefreshToken?: string;
      existingSessionId?: string;
      sessionMeta?: SessionMeta;
    },
  ): Promise<AuthResponseDto> {
    const accessToken = this.signAccess(user);
    const refreshValue = this.jwtService.sign(
      { sub: user._id },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
      },
    );

    // Derive DB expiry from the same env var so the DB check and the JWT
    // expiry are always in sync.  Falls back to 7 days if the env var is
    // missing or uses an unrecognised format.
    const expiresAt = this.parseExpiry(
      process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
    );

    // Rotate: delete only the presented refresh token (not all sessions for
    // this user) so other devices remain logged in independently.
    if (opts?.oldRefreshToken) {
      await this.db.refreshTokens.deleteOne({ token: opts.oldRefreshToken });
    }

    const sessionId = opts?.existingSessionId ?? randomUUID();
    const sessionMeta = opts?.sessionMeta;
    const now = new Date();
    await this.db.refreshTokens.insertOne({
      _id: sessionId,
      createdAt: now,
      token: refreshValue,
      userId: user._id,
      expiresAt,
      lastUsedAt: now,
      ipAddress: sessionMeta?.ipAddress ?? null,
      userAgent: sessionMeta?.userAgent ?? null,
      deviceName:
        sessionMeta?.deviceName ??
        this.deriveDeviceName(sessionMeta?.userAgent) ??
        null,
    });

    return {
      accessToken,
      refreshToken: refreshValue,
      expiresIn: 86400, // 1 day in seconds
      user: {
        id: user._id,
        email: user.email,
        username: user.username ?? null,
        name: this.encryption.decrypt(user.name),
        avatarUrl: user.avatarUrl ?? null,
        role: user.role,
        currency: user.currency,
        emailVerified: user.emailVerified,
        monthlyBudget: user.monthlyBudget ?? 0,
      },
    };
  }

  /** Parse an expiry string like "7d", "24h", "30m", "3600s" into a future Date. */
  private parseExpiry(expiresIn: string): Date {
    const match = expiresIn.match(/^(\d+)([smhd])$/i);
    if (!match) return new Date(Date.now() + 7 * 86_400_000); // fallback 7d
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const ms =
      unit === "s"
        ? value * 1_000
        : unit === "m"
          ? value * 60_000
          : unit === "h"
            ? value * 3_600_000
            : value * 86_400_000; // 'd'
    return new Date(Date.now() + ms);
  }

  private deriveDeviceName(userAgent?: string | null): string | null {
    if (!userAgent) return null;
    const ua = userAgent.toLowerCase();

    if (ua.includes("dart/") || ua.includes("flutter")) {
      if (ua.includes("android")) return "Flutter App on Android";
      if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) {
        return "Flutter App on iOS";
      }
      if (ua.includes("windows")) return "Flutter App on Windows";
      if (ua.includes("mac os") || ua.includes("macintosh")) {
        return "Flutter App on macOS";
      }
      if (ua.includes("linux")) return "Flutter App on Linux";
      return "Flutter App";
    }

    const os = ua.includes("windows")
      ? "Windows"
      : ua.includes("android")
        ? "Android"
        : ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")
          ? "iOS"
          : ua.includes("mac os") || ua.includes("macintosh")
            ? "macOS"
            : ua.includes("linux")
              ? "Linux"
              : "Unknown OS";

    const browser = ua.includes("edg/")
      ? "Edge"
      : ua.includes("opr/") || ua.includes("opera")
        ? "Opera"
        : ua.includes("samsungbrowser/")
          ? "Samsung Internet"
          : ua.includes("chrome/")
            ? "Chrome"
            : ua.includes("crios/")
              ? "Chrome"
              : ua.includes("firefox/")
                ? "Firefox"
                : ua.includes("fxios/")
                  ? "Firefox"
                  : ua.includes("safari/") && !ua.includes("chrome/")
                    ? "Safari"
                    : "Unknown Browser";

    return `${browser} on ${os}`;
  }
}
