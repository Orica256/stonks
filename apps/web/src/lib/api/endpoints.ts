import type {
  AgentDecision,
  BacktestResult,
  BenchmarkComparison,
  EquityPoint,
  Instrument,
  Market,
  Order,
  PerformanceSnapshot,
  PlaceOrderCommand,
  PortfolioSummary,
  PositionView,
  PriceBar,
  Quote,
  RunBacktestRequest,
  Timeframe,
  Trade,
} from "@stonks/contracts";
import { apiRequest } from "./client";

/**
 * `GET /accounts/:id/performance` のレスポンス（apps/api）。
 * 成績スナップショットとベンチ比較（未設定ベンチは null）を併せて返す（spec §6.8）。
 */
export interface PerformanceResult {
  snapshot: PerformanceSnapshot;
  comparison: BenchmarkComparison | null;
}

/**
 * spec §6.8 のエンドポイントに対する型付きクライアント。
 * 引数・戻り値の型はすべて @stonks/contracts から導出する（手書き型禁止）。
 */

// ── market-data ──

export function searchInstruments(
  q: string,
  market?: Market,
  signal?: AbortSignal,
): Promise<Instrument[]> {
  return apiRequest<Instrument[]>("/instruments", {
    query: { q, market },
    signal,
  });
}

export function getQuote(
  instrumentId: string,
  signal?: AbortSignal,
): Promise<Quote> {
  return apiRequest<Quote>(`/instruments/${encodeURIComponent(instrumentId)}/quote`, {
    signal,
  });
}

export function getBars(
  instrumentId: string,
  params: { timeframe: Timeframe; from?: string; to?: string },
  signal?: AbortSignal,
): Promise<PriceBar[]> {
  return apiRequest<PriceBar[]>(
    `/instruments/${encodeURIComponent(instrumentId)}/bars`,
    {
      query: {
        timeframe: params.timeframe,
        from: params.from,
        to: params.to,
      },
      signal,
    },
  );
}

// ── trading ──

export function placeOrder(
  accountId: string,
  command: Omit<PlaceOrderCommand, "accountId">,
): Promise<Order> {
  // accountId はパスを正準とする（apps/api がパス値で上書きする）。
  return apiRequest<Order>(
    `/accounts/${encodeURIComponent(accountId)}/orders`,
    { method: "POST", body: command },
  );
}

export function cancelOrder(orderId: string): Promise<Order> {
  return apiRequest<Order>(`/orders/${encodeURIComponent(orderId)}`, {
    method: "DELETE",
  });
}

// ── portfolio ──

export function getPositions(
  accountId: string,
  signal?: AbortSignal,
): Promise<PositionView[]> {
  return apiRequest<PositionView[]>(
    `/accounts/${encodeURIComponent(accountId)}/positions`,
    { signal },
  );
}

export function getSummary(
  accountId: string,
  signal?: AbortSignal,
): Promise<PortfolioSummary> {
  return apiRequest<PortfolioSummary>(
    `/accounts/${encodeURIComponent(accountId)}/summary`,
    { signal },
  );
}

export function getTrades(
  accountId: string,
  signal?: AbortSignal,
): Promise<Trade[]> {
  return apiRequest<Trade[]>(
    `/accounts/${encodeURIComponent(accountId)}/trades`,
    { signal },
  );
}

export function getHistory(
  accountId: string,
  range?: { from?: string; to?: string },
  signal?: AbortSignal,
): Promise<EquityPoint[]> {
  return apiRequest<EquityPoint[]>(
    `/accounts/${encodeURIComponent(accountId)}/history`,
    { query: { from: range?.from, to: range?.to }, signal },
  );
}

// ── agent-trader（別担当が並行実装中。spec §6.8）──

export function getPerformance(
  accountId: string,
  range?: string,
  signal?: AbortSignal,
): Promise<PerformanceResult> {
  return apiRequest<PerformanceResult>(
    `/accounts/${encodeURIComponent(accountId)}/performance`,
    { query: { range }, signal },
  );
}

export function getDecisions(
  accountId: string,
  signal?: AbortSignal,
): Promise<AgentDecision[]> {
  return apiRequest<AgentDecision[]>(
    `/accounts/${encodeURIComponent(accountId)}/decisions`,
    { signal },
  );
}

// ── backtest（spec §6.5 / §6.8）──

/**
 * `POST /backtests`（spec §6.8）。StrategyDef + 期間 + 初期資金を渡し
 * 指標（総損益・最大DD・シャープ・勝率）とエクイティカーブを得る。
 * 入出力型は contracts から導出（手書きしない）。
 */
export function runBacktest(
  req: RunBacktestRequest,
  signal?: AbortSignal,
): Promise<BacktestResult> {
  return apiRequest<BacktestResult>("/backtests", {
    method: "POST",
    body: req,
    signal,
  });
}
