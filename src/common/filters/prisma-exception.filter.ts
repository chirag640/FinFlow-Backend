import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from "@nestjs/common";
import { Response } from "express";

@Catch()
export class MongoExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    // MongoDB duplicate key error (code 11000 / 11001)
    const err = exception as Record<string, unknown>;
    const code = err?.code as number | undefined;
    if (code === 11000 || code === 11001) {
      return res.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        message: "A record with this value already exists.",
        mongoCode: code,
      });
    }

    // Not a Mongo error — let other filters handle it
    // (AllExceptionsFilter is registered at lower priority and will catch the rest)
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    res.status(status).json({
      statusCode: status,
      message: "An unexpected error occurred.",
    });
  }
}
