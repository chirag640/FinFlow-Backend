import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { IsUUID } from "class-validator";
import { Request } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { EncryptionService } from "../../common/services/encryption.service";
import { AuthService } from "./auth.service";
import { AuthResponseDto } from "./dto/auth-response.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { RegisterDto } from "./dto/register.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { AuthSessionDto, RevokeSessionDto } from "./dto/session.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";

class ResendOtpDto {
  @IsUUID()
  userId: string;
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private authService: AuthService,
    private encryption: EncryptionService,
  ) {}

  // ── Register ───────────────────────────────────────────────────────────────
  @Public()
  @Post("register")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: "Register with email + password" })
  @ApiResponse({
    status: 201,
    description: "Registration initiated — verify email to receive tokens",
  })
  @ApiResponse({ status: 409, description: "Email already in use" })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: "Login with email + password" })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  @ApiResponse({ status: 403, description: "Email not verified" })
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthResponseDto> {
    return this.authService.login(dto, this.buildSessionMeta(req));
  }

  // ── Verify Email ───────────────────────────────────────────────────────────
  @Public()
  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: "Verify email with 6-digit OTP" })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 400, description: "Invalid or expired OTP" })
  verifyEmail(
    @CurrentUser() user: any,
    @Body() dto: VerifyEmailDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    const resolvedUserId = user?.id ?? dto.userId;
    if (!resolvedUserId)
      throw new BadRequestException(
        "userId is required when not authenticated",
      );
    return this.authService.verifyEmail(
      resolvedUserId,
      dto.code,
      this.buildSessionMeta(req),
    );
  }

  // ── Resend OTP ─────────────────────────────────────────────────────────────
  @Public()
  @Post("resend-otp")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: "Resend email verification OTP" })
  @ApiResponse({ status: 204, description: "OTP re-sent" })
  resendOtp(@Body() body: ResendOtpDto): Promise<void> {
    return this.authService.resendOtp(body.userId);
  }

  // ── Forgot / Reset Password ──────────────────────────────────────────────
  @Public()
  @Post("forgot-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: "Send password reset code to email" })
  @ApiResponse({
    status: 204,
    description: "Reset code sent (if email exists)",
  })
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Post("reset-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: "Reset password using emailed 6-digit code" })
  @ApiResponse({ status: 204, description: "Password reset successful" })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.authService.resetPassword(dto.email, dto.code, dto.newPassword);
  }

  // ── Refresh ────────────────────────────────────────────────────────────────
  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Exchange refresh token for a new access token" })
  @ApiResponse({ status: 200, description: "New access token" })
  @ApiResponse({ status: 401, description: "Refresh token invalid/expired" })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(
      dto.refreshToken,
      this.buildSessionMeta(req),
    );
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  // @Public() so logout succeeds even when the access token has already
  // expired — the refresh token in the body is the only credential needed.
  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Invalidate refresh token" })
  @ApiResponse({ status: 204, description: "Logged out" })
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }

  // ── Me ─────────────────────────────────────────────────────────────────────
  @Get("me")
  @ApiOperation({ summary: "Return current authenticated user" })
  me(@CurrentUser() user: any) {
    const safe: Record<string, any> = { ...user };
    delete safe.passwordHash;
    delete safe.otpCode;
    delete safe.otpExpiresAt;
    delete safe.passwordResetCode;
    delete safe.passwordResetExpiresAt;
    safe.name = this.encryption.decrypt(safe.name);
    return safe;
  }

  @Get("sessions")
  @ApiOperation({ summary: "List active login sessions for current user" })
  @ApiResponse({ status: 200, type: [AuthSessionDto] })
  sessions(@CurrentUser("id") userId: string): Promise<AuthSessionDto[]> {
    return this.authService.listSessions(userId);
  }

  @Post("sessions/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke a specific login session" })
  @ApiResponse({ status: 204, description: "Session revoked" })
  revokeSession(
    @CurrentUser("id") userId: string,
    @Body() body: RevokeSessionDto,
  ): Promise<void> {
    return this.authService.revokeSession(userId, body.sessionId);
  }

  private buildSessionMeta(req: Request) {
    const forwarded = req.header("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || req.ip || req.socket.remoteAddress || null;
    const userAgent = req.header("user-agent") ?? null;
    const deviceName = req.header("x-device-name")?.trim() || null;
    return {
      ipAddress: ip,
      userAgent,
      deviceName,
    };
  }
}
