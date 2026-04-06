import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { BudgetsService } from "./budgets.service";
import { CreateBudgetDto } from "./dto/create-budget.dto";
import { MonthYearQueryDto } from "../expenses/dto/month-year-query.dto";
import { CurrentUser } from "../../common/decorators/current-user.decorator";

@ApiTags("budgets")
@ApiBearerAuth("access-token")
@Controller("budgets")
export class BudgetsController {
  constructor(private svc: BudgetsService) {}

  @Get()
  @ApiOperation({ summary: "Get budgets with spending for a month" })
  findByMonth(
    @CurrentUser("id") uid: string,
    @Query() query: MonthYearQueryDto,
  ) {
    return this.svc.findByMonth(uid, query.month, query.year);
  }

  @Post()
  @ApiOperation({ summary: "Upsert budget for category+month+year" })
  upsert(@CurrentUser("id") uid: string, @Body() dto: CreateBudgetDto) {
    return this.svc.upsert(uid, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.remove(id, uid);
  }
}
