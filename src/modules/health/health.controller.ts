import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";

@ApiTags("System")
@Controller({ path: "health", version: "1" })
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: "Health check" })
  @ApiResponse({ status: 200, description: "System is operational" })
  getHealth() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
