import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req.user?.id;
    if (typeof userId === "string" && userId.length > 0) {
      return `user:${userId}`;
    }

    const forwardedFor = req.headers?.["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
      return `ip:${forwardedFor.split(",")[0].trim()}`;
    }

    return `ip:${req.ip ?? "unknown"}`;
  }
}
