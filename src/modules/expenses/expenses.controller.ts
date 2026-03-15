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
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ExpensesService } from "./expenses.service";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { ExpenseQueryDto } from "./dto/expense-query.dto";
import { CurrentUser } from "../../common/decorators/current-user.decorator";

@ApiTags("expenses")
@ApiBearerAuth("access-token")
@Controller("expenses")
export class ExpensesController {
  constructor(private svc: ExpensesService) {}

  @Get()
  @ApiOperation({ summary: "Get paginated expenses (cursor-based)" })
  findAll(@CurrentUser("id") uid: string, @Query() q: ExpenseQueryDto) {
    return this.svc.findAll(uid, q);
  }

  @Get("summary")
  @ApiOperation({
    summary: "Monthly summary + 7-day trend + category breakdown",
  })
  summary(
    @CurrentUser("id") uid: string,
    @Query("month") month: number = new Date().getMonth() + 1,
    @Query("year") year: number = new Date().getFullYear(),
  ) {
    return this.svc.getSummary(uid, +month, +year);
  }

  @Get(":id")
  findOne(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.findOne(id, uid);
  }

  @Post()
  @ApiOperation({ summary: "Create expense" })
  create(@CurrentUser("id") uid: string, @Body() dto: CreateExpenseDto) {
    return this.svc.create(uid, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update expense" })
  update(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Body() dto: Partial<CreateExpenseDto>,
  ) {
    return this.svc.update(id, uid, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Soft-delete expense" })
  remove(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.remove(id, uid);
  }
}
