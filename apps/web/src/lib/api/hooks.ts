import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  AgentDecision,
  BacktestResult,
  CapitalGainsTaxEstimate,
  EquityPoint,
  Instrument,
  Market,
  Order,
  PlaceOrderCommand,
  PortfolioSummary,
  PositionView,
  PriceBar,
  Quote,
  RunBacktestRequest,
  Timeframe,
  Trade,
} from "@stonks/contracts";
import * as api from "./endpoints";
import { queryKeys } from "./query-keys";

/**
 * サーバ状態は TanStack Query で管理する（spec §3, frontend-dev 原則）。
 * 各フックは contracts の型をそのまま返す。
 */

export function useInstruments(
  q: string,
  market?: Market,
): UseQueryResult<Instrument[]> {
  return useQuery({
    queryKey: queryKeys.instruments(q, market),
    queryFn: ({ signal }) => api.searchInstruments(q, market, signal),
    enabled: q.trim().length > 0,
  });
}

export function useQuote(
  instrumentId: string | undefined,
): UseQueryResult<Quote> {
  return useQuery({
    queryKey: queryKeys.quote(instrumentId ?? ""),
    queryFn: ({ signal }) => api.getQuote(instrumentId as string, signal),
    enabled: Boolean(instrumentId),
    refetchInterval: 15_000,
  });
}

export function useBars(
  instrumentId: string | undefined,
  timeframe: Timeframe,
): UseQueryResult<PriceBar[]> {
  return useQuery({
    queryKey: queryKeys.bars(instrumentId ?? "", timeframe),
    queryFn: ({ signal }) =>
      api.getBars(instrumentId as string, { timeframe }, signal),
    enabled: Boolean(instrumentId),
  });
}

export function usePositions(
  accountId: string,
): UseQueryResult<PositionView[]> {
  return useQuery({
    queryKey: queryKeys.positions(accountId),
    queryFn: ({ signal }) => api.getPositions(accountId, signal),
  });
}

export function useSummary(
  accountId: string,
): UseQueryResult<PortfolioSummary> {
  return useQuery({
    queryKey: queryKeys.summary(accountId),
    queryFn: ({ signal }) => api.getSummary(accountId, signal),
  });
}

export function useTrades(accountId: string): UseQueryResult<Trade[]> {
  return useQuery({
    queryKey: queryKeys.trades(accountId),
    queryFn: ({ signal }) => api.getTrades(accountId, signal),
  });
}

export function useHistory(accountId: string): UseQueryResult<EquityPoint[]> {
  return useQuery({
    queryKey: queryKeys.history(accountId),
    queryFn: ({ signal }) => api.getHistory(accountId, undefined, signal),
  });
}

export function usePerformance(
  accountId: string,
  range?: string,
): UseQueryResult<api.PerformanceResult> {
  return useQuery({
    queryKey: queryKeys.performance(accountId, range),
    queryFn: ({ signal }) => api.getPerformance(accountId, range, signal),
    // 成績未確立（入金前/約定前）でもアプリを壊さない（穏当なプレースホルダ表示）。
    retry: false,
  });
}

export function useDecisions(
  accountId: string,
): UseQueryResult<AgentDecision[]> {
  return useQuery({
    queryKey: queryKeys.decisions(accountId),
    queryFn: ({ signal }) => api.getDecisions(accountId, signal),
    retry: false,
  });
}

/**
 * 譲渡益課税の概算（spec §2.3 P1）。通貨別の概算を取得する。
 * 別担当のエンドポイント未提供でもアプリを壊さないよう retry:false で穏当に縮退させる。
 */
export function useCapitalGainsTax(
  accountId: string,
  range?: { from?: string; to?: string },
): UseQueryResult<CapitalGainsTaxEstimate[]> {
  return useQuery({
    queryKey: queryKeys.capitalGainsTax(accountId, range),
    queryFn: ({ signal }) => api.getCapitalGainsTax(accountId, range, signal),
    retry: false,
  });
}

/**
 * バックテスト実行ミューテーション（spec §6.5 / §6.8 `POST /backtests`）。
 * サーバ状態を持たない一回性の計算なので無効化対象クエリはない。
 */
export function useRunBacktest(): UseMutationResult<
  BacktestResult,
  Error,
  RunBacktestRequest
> {
  return useMutation<BacktestResult, Error, RunBacktestRequest>({
    mutationFn: (req) => api.runBacktest(req),
  });
}

/** 発注ミューテーション。成功時に関連クエリを無効化して再取得させる。 */
export function usePlaceOrder(accountId: string) {
  const qc = useQueryClient();
  return useMutation<Order, Error, Omit<PlaceOrderCommand, "accountId">>({
    mutationFn: (command) => api.placeOrder(accountId, command),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.positions(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.summary(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.trades(accountId) });
    },
  });
}
