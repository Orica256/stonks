/**
 * 全モジュール共通のドメインエラー型。
 * HTTP 層（apps/api）はこれを適切なステータスにマップする。
 */
export type DomainErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_POSITION"
  | "ORDER_NOT_CANCELLABLE"
  | "MARKET_CLOSED"
  | "RISK_LIMIT_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "CONFLICT";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const isDomainError = (e: unknown): e is DomainError =>
  e instanceof DomainError;
