import { Module } from "@nestjs/common";
import { ExpensesController } from "./expenses.controller";
import { ExpensesService } from "./expenses.service";
import { ReceiptStorageService } from "./receipt-storage.service";

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService, ReceiptStorageService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
