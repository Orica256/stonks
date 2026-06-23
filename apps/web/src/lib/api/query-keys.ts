import type { Market, Timeframe } from "@stonks/contracts";

/** TanStack Query のキー定義。サーバ状態のキャッシュ境界を一箇所に集約する。 */
export const queryKeys = {
  instruments: (q: string, market?: Market) =>
    ["instruments", q, market ?? "ALL"] as const,
  quote: (instrumentId: string) => ["quote", instrumentId] as const,
  bars: (instrumentId: string, timeframe: Timeframe) =>
    ["bars", instrumentId, timeframe] as const,
  positions: (accountId: string) => ["positions", accountId] as const,
  summary: (accountId: string) => ["summary", accountId] as const,
  trades: (accountId: string) => ["trades", accountId] as const,
  orders: (accountId: string) => ["orders", accountId] as const,
  history: (accountId: string) => ["history", accountId] as const,
  performance: (accountId: string, range?: string, benchmark?: string) =>
    ["performance", accountId, range ?? "default", benchmark ?? "default"] as const,
  decisions: (accountId: string) => ["decisions", accountId] as const,
  capitalGainsTax: (
    accountId: string,
    range?: { from?: string; to?: string },
  ) =>
    [
      "tax",
      accountId,
      range?.from ?? "all",
      range?.to ?? "all",
    ] as const,
  corporateActions: (
    instrumentId: string,
    range?: { from?: string; to?: string },
  ) =>
    [
      "corporate-actions",
      instrumentId,
      range?.from ?? "all",
      range?.to ?? "all",
    ] as const,
};
