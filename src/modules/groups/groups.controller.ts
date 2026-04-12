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
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from "@nestjs/swagger";
import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AddGroupExpenseDto } from "./dto/add-group-expense.dto";
import { AddMemberDto } from "./dto/add-member.dto";
import { CreateGroupDto } from "./dto/create-group.dto";
import { GroupExpenseQueryDto } from "./dto/group-expense-query.dto";
import {
  GroupDetailResponseDto,
  GroupExpensePageResponseDto,
  GroupExpenseResponseDto,
  GroupListResponseDto,
  GroupMemberResponseDto,
  GroupResponseDto,
  GroupSettlementAuditResponseDto,
  GroupSettlementAuditTrailResponseDto,
  GroupSettlementsResponseDto,
  SettleUpResponseDto,
} from "./dto/group-response.dto";
import { UpdateGroupDto } from "./dto/update-group.dto";
import { GroupsService } from "./groups.service";

class SettleUpDto {
  @ApiProperty({ example: "39ce53c4-f2f2-48bc-89ee-d5f52a825129" })
  @IsString()
  fromMemberId: string;

  @ApiProperty({ example: "fda93b47-8304-42c0-bec8-995f5e96f6e5" })
  @IsString()
  toMemberId: string;

  @ApiProperty({ example: 450 })
  @IsNumber()
  @IsPositive()
  amount: number;
}

class DisputeSettlementDto {
  @ApiProperty({ minLength: 3, maxLength: 240, example: "Amount mismatch" })
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason: string;

  @ApiPropertyOptional({
    maxLength: 500,
    example: "Please verify transfer screenshot",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class ResolveSettlementDisputeDto {
  @ApiPropertyOptional({
    maxLength: 500,
    example: "Owner verified and resolved",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolutionNote?: string;
}

@ApiTags("groups")
@ApiBearerAuth("access-token")
@Controller("groups")
export class GroupsController {
  constructor(private svc: GroupsService) {}

  @Get()
  @ApiOperation({ summary: "List all groups for current user" })
  @ApiOkResponse({ type: [GroupListResponseDto] })
  findAll(@CurrentUser("id") uid: string) {
    return this.svc.findAll(uid);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get group with members + expenses" })
  @ApiOkResponse({ type: GroupDetailResponseDto })
  @ApiNotFoundResponse({ description: "Group not found" })
  findOne(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.findOne(id, uid);
  }

  @Post()
  @ApiOperation({ summary: "Create group" })
  @ApiBody({ type: CreateGroupDto })
  @ApiCreatedResponse({ type: GroupResponseDto })
  create(@CurrentUser("id") uid: string, @Body() dto: CreateGroupDto) {
    return this.svc.create(uid, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update group (owner only)" })
  @ApiBody({ type: UpdateGroupDto })
  @ApiOkResponse({ type: GroupResponseDto })
  @ApiNotFoundResponse({ description: "Group not found" })
  update(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.svc.update(id, uid, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: "Group soft-deleted" })
  @ApiNotFoundResponse({ description: "Group not found" })
  remove(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.remove(id, uid);
  }

  @Post(":id/members")
  @ApiOperation({ summary: "Add member to group (owner only)" })
  @ApiBody({ type: AddMemberDto })
  @ApiCreatedResponse({ type: GroupMemberResponseDto })
  @ApiNotFoundResponse({ description: "Group not found" })
  addMember(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.svc.addMember(id, uid, dto);
  }

  @Post(":id/expenses")
  @ApiOperation({ summary: "Add group expense" })
  @ApiBody({ type: AddGroupExpenseDto })
  @ApiCreatedResponse({ type: GroupExpenseResponseDto })
  @ApiNotFoundResponse({ description: "Group not found" })
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
  @ApiNoContentResponse({ description: "Group expense soft-deleted" })
  @ApiNotFoundResponse({ description: "Group or expense not found" })
  removeExpense(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Param("expenseId") expenseId: string,
  ) {
    return this.svc.removeExpense(id, expenseId, uid);
  }

  @Get(":id/settlements")
  @ApiOperation({ summary: "Get simplified debt settlements" })
  @ApiOkResponse({ type: GroupSettlementsResponseDto })
  @ApiNotFoundResponse({ description: "Group not found" })
  getSettlements(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.getSettlements(id, uid);
  }

  @Get(":id/expenses")
  @ApiOperation({ summary: "Get paginated group expenses" })
  @ApiOkResponse({ type: GroupExpensePageResponseDto })
  @ApiNotFoundResponse({ description: "Group not found" })
  getGroupExpenses(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Query() query: GroupExpenseQueryDto,
  ) {
    return this.svc.getGroupExpenses(id, uid, query);
  }

  @Get(":id/settlement-audits")
  @ApiOperation({ summary: "Get group settlement audit trail" })
  @ApiOkResponse({ type: GroupSettlementAuditTrailResponseDto })
  @ApiNotFoundResponse({ description: "Group not found" })
  getSettlementAuditTrail(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
  ) {
    return this.svc.getSettlementAuditTrail(id, uid);
  }

  @Post(":id/settlement-audits/:settlementExpenseId/dispute")
  @ApiOperation({ summary: "Attach dispute metadata to a settlement record" })
  @ApiBody({ type: DisputeSettlementDto })
  @ApiCreatedResponse({ type: GroupSettlementAuditResponseDto })
  @ApiNotFoundResponse({ description: "Group or settlement record not found" })
  disputeSettlement(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Param("settlementExpenseId") settlementExpenseId: string,
    @Body() dto: DisputeSettlementDto,
  ) {
    return this.svc.disputeSettlement(
      id,
      uid,
      settlementExpenseId,
      dto.reason,
      dto.note,
    );
  }

  @Post(":id/settlement-audits/:settlementExpenseId/resolve")
  @ApiOperation({
    summary: "Resolve an active settlement dispute (group owner only)",
  })
  @ApiBody({ type: ResolveSettlementDisputeDto })
  @ApiCreatedResponse({ type: GroupSettlementAuditResponseDto })
  @ApiNotFoundResponse({ description: "Group or settlement record not found" })
  resolveSettlementDispute(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Param("settlementExpenseId") settlementExpenseId: string,
    @Body() dto: ResolveSettlementDisputeDto,
  ) {
    return this.svc.resolveSettlementDispute(
      id,
      uid,
      settlementExpenseId,
      dto.resolutionNote,
    );
  }

  @Post(":id/settle")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Record a settlement payment — zeroes the debt between two members",
  })
  @ApiBody({ type: SettleUpDto })
  @ApiCreatedResponse({ type: SettleUpResponseDto })
  @ApiNotFoundResponse({ description: "Group or member not found" })
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
