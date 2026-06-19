import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import { type DomainErrorCode, isDomainError } from "@stonks/contracts";

/** DomainError のコードを HTTP ステータスにマップする（spec §6 / errors.ts）。 */
const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  NOT_FOUND: HttpStatus.NOT_FOUND,
  VALIDATION: HttpStatus.BAD_REQUEST,
  INSUFFICIENT_FUNDS: HttpStatus.UNPROCESSABLE_ENTITY,
  INSUFFICIENT_POSITION: HttpStatus.UNPROCESSABLE_ENTITY,
  ORDER_NOT_CANCELLABLE: HttpStatus.CONFLICT,
  MARKET_CLOSED: HttpStatus.UNPROCESSABLE_ENTITY,
  RISK_LIMIT_EXCEEDED: HttpStatus.UNPROCESSABLE_ENTITY,
  PROVIDER_UNAVAILABLE: HttpStatus.BAD_GATEWAY,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  CONFLICT: HttpStatus.CONFLICT,
};

/**
 * 全例外を JSON エラー本文に正規化するフィルタ。
 * DomainError は契約コードでマップし、HttpException はそのまま、
 * それ以外は 500 にフォールバックする。秘密情報はメッセージに出さない。
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (isDomainError(exception)) {
      const status = STATUS_BY_CODE[exception.code] ?? HttpStatus.BAD_REQUEST;
      res.status(status).json({
        error: { code: exception.code, message: exception.message },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(
        typeof body === "string" ? { error: { message: body } } : body,
      );
      return;
    }

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: "INTERNAL", message: "internal server error" },
    });
  }
}
