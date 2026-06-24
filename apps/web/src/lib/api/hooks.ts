import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  AgentDecision,
  BacktestResult,
  BenchmarkId,
  CapitalGainsTaxEstimate,
  CorporateAction,
  EquityPoint,
  Instrument,
  MarginRequirement,
  Market,
  Order,
  PlaceBracketOrderCommand,
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

/**
 * 銘柄メタ情報（`GET /instruments/:id`。Phase 6）。
 *
 * instrumentId から `Instrument`（symbol/name/currency 等）を解決し、一覧の表示改善に使う。
 * メタ情報はほぼ不変なので staleTime を長くとり、同一 id の重複取得を React Query の
 * キャッシュで抑える。`instrumentId` が falsy のときは取得しない（enabled:false）。
 * 未解決（404/エラー）でも呼び出し側が parseInstrumentId にフォールバックできるよう
 * retry:false で穏当に縮退させる。
 */
export function useInstrument(
  instrumentId: string | undefined,
): UseQueryResult<Instrument> {
  return useQuery({
    queryKey: queryKeys.instrument(instrumentId ?? ""),
    queryFn: ({ signal }) => api.getInstrument(instrumentId as string, signal),
    enabled: Boolean(instrumentId),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}

/**
 * 複数 instrumentId をまとめて解決し、id→Instrument の Map を返す（Phase 6）。
 *
 * 一覧（オープン注文など）で行ごとに無闇に多重 fetch する N+1 を避けるため、
 * ユニークな id 集合に対してのみ取得する。各 id は React Query のキャッシュ
 * （`useInstrument` と同じ queryKey）を共有するので重複取得が抑制される。
 * 未解決（404/エラー）の id は Map に載らないだけで、呼び出し側は parseInstrumentId に
 * フォールバックできる（捏造したエントリを入れない）。
 */
export function useInstrumentMap(
  instrumentIds: readonly string[],
): Map<string, Instrument> {
  // 安定した順序のユニーク集合（依存比較の安定化のため文字列キー化）。
  const uniqueIds = Array.from(new Set(instrumentIds)).sort();
  const results = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: queryKeys.instrument(id),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        api.getInstrument(id, signal),
      staleTime: 60 * 60 * 1000,
      retry: false,
    })),
  });

  const map = new Map<string, Instrument>();
  results.forEach((result, i) => {
    if (result.data) map.set(uniqueIds[i] as string, result.data);
  });
  return map;
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

/**
 * 信用建ての必要保証金プレビュー（`GET /instruments/:id/margin-requirement`。Phase 7）。
 *
 * side/数量/価格が確定したときだけ取得する（数量 0 や instrument 未選択では enabled:false）。
 * 信用不可（api が HTTP 400）は `ApiError` として error 状態で拾い、UI で「プレビュー不可
 * （信用不可）」と縮退表示する。捏造した保証金値を返さないため retry:false で穏当に止める。
 * 価格未指定（price:undefined）のときは api 側が最新価格を使う。
 */
export function useMarginRequirement(
  instrumentId: string | undefined,
  params: api.MarginRequirementParams,
  enabled: boolean,
): UseQueryResult<MarginRequirement> {
  return useQuery({
    queryKey: queryKeys.marginRequirement(
      instrumentId ?? "",
      params.side,
      params.quantity,
      params.price,
      params.marginType ?? "MARGIN",
    ),
    queryFn: ({ signal }) =>
      api.getMarginRequirement(instrumentId as string, params, signal),
    enabled: Boolean(instrumentId) && enabled && params.quantity > 0,
    retry: false,
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

/**
 * 口座の注文一覧（`GET /accounts/:id/orders`。Phase 6）。
 * 全件取得し、オープン注文の絞り込みは UI 側（open-orders-panel）で行う。
 */
export function useOrders(accountId: string): UseQueryResult<Order[]> {
  return useQuery({
    queryKey: queryKeys.orders(accountId),
    queryFn: ({ signal }) => api.getOrders(accountId, undefined, signal),
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
  benchmark?: BenchmarkId,
): UseQueryResult<api.PerformanceResult> {
  return useQuery({
    queryKey: queryKeys.performance(accountId, range, benchmark),
    queryFn: ({ signal }) =>
      api.getPerformance(accountId, range, benchmark, signal),
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

/**
 * 指定銘柄の配当・分割イベント一覧（spec §2.3 / market-data）。
 * 期間無指定時は API 既定範囲に委ねる。未提供でもアプリを壊さないよう retry:false。
 */
export function useCorporateActions(
  instrumentId: string | undefined,
  range?: { from?: string; to?: string },
): UseQueryResult<CorporateAction[]> {
  return useQuery({
    queryKey: queryKeys.corporateActions(instrumentId ?? "", range),
    queryFn: ({ signal }) =>
      api.getCorporateActions(instrumentId as string, range, signal),
    enabled: Boolean(instrumentId),
    retry: false,
  });
}

/**
 * コーポレートアクションを口座へ反映するミューテーション
 * （`POST /accounts/:id/corporate-actions`）。成功時にポジション/サマリ/取引履歴を無効化する。
 */
export function useApplyCorporateAction(
  accountId: string,
): UseMutationResult<{ ok: true }, Error, CorporateAction> {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, CorporateAction>({
    mutationFn: (action) => api.applyCorporateAction(accountId, action),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.positions(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.summary(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.trades(accountId) });
    },
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
      void qc.invalidateQueries({ queryKey: queryKeys.orders(accountId) });
    },
  });
}

/**
 * 単発注文の取消ミューテーション（`DELETE /orders/:id`）。
 * 取消後はポジション/サマリ/取引履歴/注文一覧を無効化する。
 */
export function useCancelOrder(accountId: string) {
  const qc = useQueryClient();
  return useMutation<Order, Error, string>({
    mutationFn: (orderId) => api.cancelOrder(orderId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.positions(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.summary(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.trades(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.orders(accountId) });
    },
  });
}

/**
 * 複合発注ミューテーション（OCO / IFD / BRACKET。Phase 5）。
 * 成功時はポジション/サマリ/取引履歴を無効化する（単発 usePlaceOrder に倣う）。
 * accountId はパス正準のため body に含めない。
 */
export function usePlaceBracketOrder(accountId: string) {
  const qc = useQueryClient();
  return useMutation<Order[], Error, PlaceBracketOrderCommand>({
    mutationFn: (command) => api.placeBracketOrder(accountId, command),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.positions(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.summary(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.trades(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.orders(accountId) });
    },
  });
}

/**
 * 複合注文グループの一括取消ミューテーション（Phase 5）。
 * グループ取消後はポジション/サマリ/取引履歴を無効化する。
 */
export function useCancelOrderGroup(accountId: string) {
  const qc = useQueryClient();
  return useMutation<Order[], Error, string>({
    mutationFn: (linkGroupId) => api.cancelOrderGroup(linkGroupId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.positions(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.summary(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.trades(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.orders(accountId) });
    },
  });
}
