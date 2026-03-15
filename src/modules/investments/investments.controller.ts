import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { InvestmentsService } from "./investments.service";
import { CreateInvestmentDto } from "./dto/create-investment.dto";

@ApiTags("investments")
@ApiBearerAuth("access-token")
@Controller("investments")
export class InvestmentsController {
  constructor(private svc: InvestmentsService) {}

  @Get()
  @ApiOperation({ summary: "Get all investments + portfolio summary" })
  findAll(@CurrentUser("id") uid: string) {
    return this.svc.findAll(uid);
  }

  @Get("net-worth")
  @ApiOperation({ summary: "Get aggregated net worth from investments" })
  netWorth(@CurrentUser("id") uid: string) {
    return this.svc.netWorth(uid);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get single investment" })
  findOne(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.findOne(id, uid);
  }

  @Post()
  @ApiOperation({ summary: "Create investment" })
  @ApiResponse({ status: 201, description: "Investment created" })
  create(@CurrentUser("id") uid: string, @Body() dto: CreateInvestmentDto) {
    return this.svc.create(uid, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update investment (partial)" })
  update(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Body() dto: Partial<CreateInvestmentDto>,
  ) {
    return this.svc.update(id, uid, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Soft-delete investment" })
  remove(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.remove(id, uid);
  }
}
