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
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsNumber, IsPositive, IsString } from "class-validator";
import { GroupsService } from "./groups.service";
import { CreateGroupDto } from "./dto/create-group.dto";
import { AddGroupExpenseDto } from "./dto/add-group-expense.dto";
import { AddMemberDto } from "./dto/add-member.dto";
import { CurrentUser } from "../../common/decorators/current-user.decorator";

class SettleUpDto {
  @IsString() fromMemberId: string;
  @IsString() toMemberId: string;
  @IsNumber() @IsPositive() amount: number;
}

@ApiTags("groups")
@ApiBearerAuth("access-token")
@Controller("groups")
export class GroupsController {
  constructor(private svc: GroupsService) {}

  @Get()
  @ApiOperation({ summary: "List all groups for current user" })
  findAll(@CurrentUser("id") uid: string) {
    return this.svc.findAll(uid);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get group with members + expenses" })
  findOne(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.findOne(id, uid);
  }

  @Post()
  @ApiOperation({ summary: "Create group" })
  create(@CurrentUser("id") uid: string, @Body() dto: CreateGroupDto) {
    return this.svc.create(uid, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update group (owner only)" })
  update(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Body() dto: Partial<CreateGroupDto>,
  ) {
    return this.svc.update(id, uid, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.remove(id, uid);
  }

  @Post(":id/members")
  @ApiOperation({ summary: "Add member to group (owner only)" })
  addMember(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.svc.addMember(id, uid, dto);
  }

  @Post(":id/expenses")
  @ApiOperation({ summary: "Add group expense" })
  addExpense(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Body() dto: AddGroupExpenseDto,
  ) {
    return this.svc.addExpense(id, uid, dto);
  }

  @Delete(":id/expenses/:expenseId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Delete a group expense (non-settlement, any member)",
  })
  removeExpense(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Param("expenseId") expenseId: string,
  ) {
    return this.svc.removeExpense(id, expenseId, uid);
  }

  @Get(":id/settlements")
  @ApiOperation({ summary: "Get simplified debt settlements" })
  getSettlements(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.getSettlements(id, uid);
  }

  @Post(":id/settle")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Record a settlement payment — zeroes the debt between two members",
  })
  settleUp(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Body() dto: SettleUpDto,
  ) {
    return this.svc.settleUp(
      id,
      uid,
      dto.fromMemberId,
      dto.toMemberId,
      dto.amount,
    );
  }
}
