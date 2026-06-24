import type {
  AgentDecision,
  BacktestResult,
  BenchmarkComparison,
  BenchmarkComparisonResult,
  BenchmarkId,
  CapitalGainsTaxEstimate,
  CorporateAction,
  EquityPoint,
  Instrument,
  MarginRequirement,
  MarginType,
  Market,
  Order,
  OrderSide,
  PerformanceSnapshot,
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
import { apiRequest } from "./client";

/**
 * `GET /accounts/:id/performance` のレスポンス（apps/api）。
 * 成績スナップショットとベンチ比較を併せて返す（spec §6.8）。
 *
 * `comparison` は従来どおりの後方互換キー（未成立は null）。
 * `comparisonResult` は新規（成立/不成立を理由付きで表現する discriminated union）。
 * UI の理由提示は `comparisonResult` を正準とする（推測リターンを出さない・spec §2.7 P1）。
 */
export interface PerformanceResult {
  snapshot: PerformanceSnapshot;
  comparison: BenchmarkComparison | null;
  comparisonResult: BenchmarkComparisonResult;
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

/**
 * `GET /instruments/:id`（銘柄メタ情報。Phase 6）。
 *
 * instrumentId（`EXCHANGE:SYMBOL`）から契約型 `Instrument`（symbol/name/currency/
 * exchange/lotSize 等）を解決する。見つからなければ api は 404 を返し、既存 `ApiError`
 * として呼び出し側へ伝播する（捏造したフォールバック値を返さない）。戻り値は契約型そのまま。
 */
export function getInstrument(
  instrumentId: string,
  signal?: AbortSignal,
): Promise<Instrument> {
  return apiRequest<Instrument>(
    `/instruments/${encodeURIComponent(instrumentId)}`,
    { signal },
  );
}

/** `GET /instruments/:id/margin-requirement` の入力（spec §2.2 / Phase 7）。 */
export interface MarginRequirementParams {
  side: OrderSide;
  /** 正の整数。 */
  quantity: number;
  /** DecimalString（任意。省略時 api が最新価格を使用）。 */
  price?: string | undefined;
  /** 既定 MARGIN。 */
  marginType?: MarginType | undefined;
}

/**
 * `GET /instruments/:id/margin-requirement`（信用建ての必要保証金プレビュー。Phase 7）。
 *
 * 数量・価格・side から建玉の総代金/必要保証金/適用保証金率を概算して返す。
 * 信用不可（policy 未設定 / marginTradable=false で BUY / shortMarginable=false で SELL）の
 * 場合 api は HTTP 400 を返し、既存 `ApiError` として呼び出し側へ伝播する（捏造値を返さない）。
 * 金額は DecimalString のまま受け取り、web では表示整形のみ行う（CLAUDE.md §0）。
 */
export function getMarginRequirement(
  instrumentId: string,
  params: MarginRequirementParams,
  signal?: AbortSignal,
): Promise<MarginRequirement> {
  return apiRequest<MarginRequirement>(
    `/instruments/${encodeURIComponent(instrumentId)}/margin-requirement`,
    {
      query: {
        side: params.side,
        quantity: params.quantity,
        price: params.price,
        marginType: params.marginType,
      },
      signal,
    },
  );
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

/**
 * `GET /accounts/:id/orders`（口座の注文一覧。新しい順。Phase 6）。
 *
 * `open` を渡すと API 側でオープン注文（status PENDING/PARTIALLY_FILLED または
 * activation==="WAITING"）に絞れる可能性があるが、未対応の API でも壊れないよう
 * 呼び出し側で全件取得→web で絞る運用を正準とする（query は任意で付与）。
 * 戻り値は契約型 `Order[]` そのまま（手書き型を作らない）。
 */
export function getOrders(
  accountId: string,
  open?: boolean,
  signal?: AbortSignal,
): Promise<Order[]> {
  return apiRequest<Order[]>(
    `/accounts/${encodeURIComponent(accountId)}/orders`,
    {
      query: open ? { open: "true" } : undefined,
      signal,
    },
  );
}

/**
 * `POST /accounts/:id/orders/bracket`（複合発注 OCO / IFD / BRACKET。Phase 5）。
 *
 * 各 leg/parent/child の accountId はパスを正準として api 側が注入するため、
 * body には accountId を含めない（単発 placeOrder と同じ規約）。レスポンスは
 * 生成された注文群 `Order[]`（OCO は 2、IFD は親 1＋子 N、bracket は親 1＋子 2）。
 */
export function placeBracketOrder(
  accountId: string,
  command: PlaceBracketOrderCommand,
): Promise<Order[]> {
  return apiRequest<Order[]>(
    `/accounts/${encodeURIComponent(accountId)}/orders/bracket`,
    { method: "POST", body: command },
  );
}

/**
 * `DELETE /orders/groups/:linkGroupId`（複合注文グループの一括取消。Phase 5）。
 * グループに属するオープン/待機注文を CANCELLED にして返す。
 */
export function cancelOrderGroup(linkGroupId: string): Promise<Order[]> {
  return apiRequest<Order[]>(
    `/orders/groups/${encodeURIComponent(linkGroupId)}`,
    { method: "DELETE" },
  );
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

/**
 * `GET /accounts/:id/tax?from=&to=`（spec §2.3 P1「税計算（譲渡益課税の概算）」）。
 * 期間内の RealizedPnl から導出した通貨別の概算（益のみ課税対象・損失は 0 床）を返す。
 * 戻り値は契約型 `CapitalGainsTaxEstimate[]` そのまま（手書き型を作らない）。
 * 別担当が並行実装中。range 無指定時は API 側の既定期間（年初来等）に委ねる。
 */
export function getCapitalGainsTax(
  accountId: string,
  range?: { from?: string; to?: string },
  signal?: AbortSignal,
): Promise<CapitalGainsTaxEstimate[]> {
  return apiRequest<CapitalGainsTaxEstimate[]>(
    `/accounts/${encodeURIComponent(accountId)}/tax`,
    { query: { from: range?.from, to: range?.to }, signal },
  );
}

// ── agent-trader（別担当が並行実装中。spec §6.8）──

export function getPerformance(
  accountId: string,
  range?: string,
  benchmark?: BenchmarkId,
  signal?: AbortSignal,
): Promise<PerformanceResult> {
  return apiRequest<PerformanceResult>(
    `/accounts/${encodeURIComponent(accountId)}/performance`,
    { query: { range, benchmark }, signal },
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

// ── corporate actions（spec §2.3 / market-data）──

/**
 * `GET /instruments/:id/corporate-actions?from=&to=`。
 * 指定銘柄の配当・分割イベント（`exDate` が期間内）を取得する。
 * 期間無指定時は API 側の既定範囲に委ねる。戻り値は契約型そのまま（手書きしない）。
 */
export function getCorporateActions(
  instrumentId: string,
  range?: { from?: string; to?: string },
  signal?: AbortSignal,
): Promise<CorporateAction[]> {
  return apiRequest<CorporateAction[]>(
    `/instruments/${encodeURIComponent(instrumentId)}/corporate-actions`,
    { query: { from: range?.from, to: range?.to }, signal },
  );
}

/**
 * `POST /accounts/:id/corporate-actions`（body=`CorporateAction`）。
 * コーポレートアクションを口座へ反映する（配当→現金/台帳、分割→ポジション調整は api が実施）。
 * 投資助言ではなくシミュレーション上の反映操作（CLAUDE.md §7）。
 */
export function applyCorporateAction(
  accountId: string,
  action: CorporateAction,
): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(
    `/accounts/${encodeURIComponent(accountId)}/corporate-actions`,
    { method: "POST", body: action },
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
