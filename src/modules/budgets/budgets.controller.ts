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
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { MonthYearQueryDto } from "../expenses/dto/month-year-query.dto";
import { BudgetsService } from "./budgets.service";
import { BudgetResponseDto } from "./dto/budget-response.dto";
import { CreateBudgetDto } from "./dto/create-budget.dto";

@ApiTags("budgets")
@ApiBearerAuth("access-token")
@Controller("budgets")
export class BudgetsController {
  constructor(private svc: BudgetsService) {}

  @Get()
  @ApiOperation({ summary: "Get budgets with spending for a month" })
  @ApiOkResponse({ type: [BudgetResponseDto] })
  findByMonth(
    @CurrentUser("id") uid: string,
    @Query() query: MonthYearQueryDto,
  ) {
    return this.svc.findByMonth(uid, query.month, query.year);
  }

  @Post()
  @ApiOperation({ summary: "Upsert budget for category+month+year" })
  @ApiBody({ type: CreateBudgetDto })
  @ApiCreatedResponse({ type: BudgetResponseDto })
  upsert(@CurrentUser("id") uid: string, @Body() dto: CreateBudgetDto) {
    return this.svc.upsert(uid, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: "Budget soft-deleted" })
  @ApiNotFoundResponse({ description: "Budget not found" })
  remove(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.remove(id, uid);
  }
}
