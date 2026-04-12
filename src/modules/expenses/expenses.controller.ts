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
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { RECEIPT_CONFIG } from "../../common/constants";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { ExpenseBatchOperationDto } from "./dto/expense-batch.dto";
import { ExpenseDuplicateCheckDto } from "./dto/expense-duplicate-check.dto";
import { ExpenseQueryDto } from "./dto/expense-query.dto";
import {
  ExpenseBatchOperationResponseDto,
  ExpenseDuplicateCheckResponseDto,
  ExpensePageResponseDto,
  ExpenseResponseDto,
  ExpenseSummaryResponseDto,
} from "./dto/expense-response.dto";
import { MonthYearQueryDto } from "./dto/month-year-query.dto";
import {
  CreateReceiptUploadIntentDto,
  ReceiptUploadIntentResponseDto,
  UploadReceiptRequestDto,
  UploadReceiptResponseDto,
} from "./dto/receipt-upload.dto";
import { UpdateExpenseDto } from "./dto/update-expense.dto";
import { ExpensesService } from "./expenses.service";
import { ReceiptStorageService } from "./receipt-storage.service";

@ApiTags("expenses")
@ApiBearerAuth("access-token")
@Controller("expenses")
export class ExpensesController {
  private static readonly EMPTY_UPLOAD_FILE = {
    buffer: Buffer.alloc(0),
    size: 0,
    mimetype: "",
  };

  constructor(
    private svc: ExpensesService,
    private readonly receiptStorage: ReceiptStorageService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Get paginated expenses (cursor-based)" })
  @ApiOkResponse({ type: ExpensePageResponseDto })
  findAll(@CurrentUser("id") uid: string, @Query() q: ExpenseQueryDto) {
    return this.svc.findAll(uid, q);
  }

  @Get("summary")
  @ApiOperation({
    summary: "Monthly summary + 7-day trend + category breakdown",
  })
  @ApiOkResponse({ type: ExpenseSummaryResponseDto })
  summary(@CurrentUser("id") uid: string, @Query() query: MonthYearQueryDto) {
    return this.svc.getSummary(uid, query.month, query.year);
  }

  @Post("duplicates/check")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Check potential duplicate expenses" })
  @ApiBody({ type: ExpenseDuplicateCheckDto })
  @ApiOkResponse({ type: ExpenseDuplicateCheckResponseDto })
  checkDuplicates(
    @CurrentUser("id") uid: string,
    @Body() dto: ExpenseDuplicateCheckDto,
  ) {
    return this.svc.checkPotentialDuplicates(uid, dto);
  }

  @Post("batch")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Apply batch operations to expenses" })
  @ApiBody({ type: ExpenseBatchOperationDto })
  @ApiOkResponse({ type: ExpenseBatchOperationResponseDto })
  batchOperation(
    @CurrentUser("id") uid: string,
    @Body() dto: ExpenseBatchOperationDto,
  ) {
    return this.svc.applyBatchOperation(uid, dto);
  }

  @Post("receipts/upload-intent")
  @ApiOperation({
    summary: "Create signed upload intent for receipt image storage",
  })
  @ApiBody({ type: CreateReceiptUploadIntentDto })
  @ApiCreatedResponse({ type: ReceiptUploadIntentResponseDto })
  createReceiptUploadIntent(
    @CurrentUser("id") uid: string,
    @Body() dto: CreateReceiptUploadIntentDto,
    @Req() req: Request,
  ) {
    return this.receiptStorage.createUploadIntent(
      uid,
      dto.mimeType,
      this.resolveRequestOrigin(req),
    );
  }

  @Post("receipts/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: RECEIPT_CONFIG.MAX_UPLOAD_BYTES },
    }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload receipt image using signed upload intent" })
  @ApiBody({ type: UploadReceiptRequestDto })
  @ApiCreatedResponse({ type: UploadReceiptResponseDto })
  uploadReceipt(
    @CurrentUser("id") uid: string,
    @Body() dto: UploadReceiptRequestDto,
    @UploadedFile()
    file:
      | {
          buffer: Buffer;
          size: number;
          mimetype?: string;
        }
      | undefined,
    @Req() req: Request,
  ) {
    return this.receiptStorage.uploadFromIntent({
      userId: uid,
      receiptStorageKey: dto.receiptStorageKey,
      expiresAt: dto.expiresAt,
      signature: dto.signature,
      mimeType: dto.mimeType,
      file: file ?? ExpensesController.EMPTY_UPLOAD_FILE,
      requestOrigin: this.resolveRequestOrigin(req),
    });
  }

  @Public()
  @Get("receipts/file/:encodedStorageKey")
  @ApiOperation({ summary: "Fetch uploaded receipt image by encoded key" })
  @ApiOkResponse({ description: "Receipt image binary" })
  async getReceiptFile(
    @Param("encodedStorageKey") encodedStorageKey: string,
    @Res() res: Response,
  ) {
    const file = await this.receiptStorage.getReceiptFile(encodedStorageKey);

    if (file.mode === "redirect") {
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      return res.redirect(file.redirectUrl);
    }

    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Type", file.mimeType);
    return res.sendFile(file.absolutePath);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get expense by id" })
  @ApiOkResponse({ type: ExpenseResponseDto })
  @ApiNotFoundResponse({ description: "Expense not found" })
  findOne(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.findOne(id, uid);
  }

  @Post()
  @ApiOperation({ summary: "Create expense" })
  @ApiBody({ type: CreateExpenseDto })
  @ApiCreatedResponse({ type: ExpenseResponseDto })
  create(@CurrentUser("id") uid: string, @Body() dto: CreateExpenseDto) {
    return this.svc.create(uid, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update expense" })
  @ApiBody({ type: UpdateExpenseDto })
  @ApiOkResponse({ type: ExpenseResponseDto })
  @ApiNotFoundResponse({ description: "Expense not found" })
  update(
    @CurrentUser("id") uid: string,
    @Param("id") id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.svc.update(id, uid, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Soft-delete expense" })
  @ApiNoContentResponse({ description: "Expense soft-deleted" })
  @ApiNotFoundResponse({ description: "Expense not found" })
  remove(@CurrentUser("id") uid: string, @Param("id") id: string) {
    return this.svc.remove(id, uid);
  }

  private resolveRequestOrigin(req: Request): string {
    const forwardedProto = req
      .header("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();
    const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
    const protocol = forwardedProto || req.protocol || "http";
    const host = forwardedHost || req.get("host") || "localhost:3000";
    return `${protocol}://${host}`;
  }
}
