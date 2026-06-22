import { z } from "zod";
import { DateRange, DecimalString, Id, Timestamp } from "./common.js";
import { PlaceOrderCommand, type Order } from "./order.js";

/** エージェントの動作モード（spec §2.7）。 */
export const AgentMode = z.enum(["MANUAL_MCP", "AUTONOMOUS"]);
export type AgentMode = z.infer<typeof AgentMode>;

/** 暴走防止のリスク制限（RiskGuard が参照）。 */
export const RiskLimits = z.object({
  maxOrderNotional: DecimalString.optional(), // 1 注文の最大金額（基軸）
  maxDailyNotional: DecimalString.optional(), // 1 日の最大発注金額
  maxPositionPct: z.number().min(0).max(1).optional(), // 1 銘柄の最大集中度
});
export type RiskLimits = z.infer<typeof RiskLimits>;

export const AgentProfile = z.object({
  id: Id,
  name: z.string().min(1),
  model: z.string(), // 例: "claude-opus-4-8"
  strategyPrompt: z.string().optional(),
  mode: AgentMode.default("MANUAL_MCP"),
  schedule: z.string().optional(), // AUTONOMOUS のみ（cron）
  riskLimits: RiskLimits.default({}),
  enabled: z.boolean().default(true),
  createdAt: Timestamp,
});
export type AgentProfile = z.infer<typeof AgentProfile>;

/** エージェントが提案する 1 アクション。発注は PlaceOrderCommand を内包。 */
export const AgentAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ORDER"), order: PlaceOrderCommand }),
  z.object({ kind: z.literal("CANCEL"), orderId: Id }),
  z.object({ kind: z.literal("HOLD"), note: z.string().optional() }),
]);
export type AgentAction = z.infer<typeof AgentAction>;

/** 意思決定ログ = 監査証跡（spec §5.1, §5.2 不変条件）。 */
export const AgentDecision = z.object({
  id: Id,
  agentProfileId: Id,
  accountId: Id,
  ts: Timestamp,
  model: z.string(),
  inputContext: z.unknown(), // 判断材料のスナップショット
  rationale: z.string().min(1), // 根拠（必須）
  proposedActions: z.array(AgentAction),
  resultOrderIds: z.array(Id).default([]),
});
export type AgentDecision = z.infer<typeof AgentDecision>;

/** 自律ループが LLM に渡す観測（市況/保有/成績の要約）。 */
export const AgentObservation = z.object({
  accountId: Id,
  asOf: Timestamp,
  cashByCurrency: z.record(DecimalString),
  positions: z.array(
    z.object({
      instrumentId: Id,
      symbol: z.string(),
      quantity: z.number(),
      marketPrice: DecimalString,
      unrealizedPnlPct: z.number(),
    }),
  ),
  recentQuotes: z.array(
    z.object({ instrumentId: Id, symbol: z.string(), last: DecimalString }),
  ),
});
export type AgentObservation = z.infer<typeof AgentObservation>;

// ── 成績評価（ライブ・フォワードテスト。spec §2.7） ──
export const PerformanceSnapshot = z.object({
  accountId: Id,
  ts: Timestamp,
  equity: DecimalString,
  cash: DecimalString,
  positionsValue: DecimalString,
  cumulativeReturn: z.number(),
  maxDrawdown: z.number(),
  sharpe: z.number(),
  winRate: z.number(),
});
export type PerformanceSnapshot = z.infer<typeof PerformanceSnapshot>;

export const BenchmarkId = z.enum(["BUY_AND_HOLD", "TOPIX", "SP500"]);
export type BenchmarkId = z.infer<typeof BenchmarkId>;

export const BenchmarkComparison = z.object({
  accountId: Id,
  benchmark: BenchmarkId,
  range: DateRange,
  strategyReturn: z.number(),
  benchmarkReturn: z.number(),
  excessReturn: z.number(),
});
export type BenchmarkComparison = z.infer<typeof BenchmarkComparison>;

/**
 * ベンチ比較が公正に成立しない理由（spec §2.7 P1 / §9 公正性）。
 *
 * 値を捏造せず「比較不能」を明示するための列挙（推測リターンを出さない）。
 * - `NOT_CONFIGURED`: 当該ベンチの instrumentId が設定されていない。
 * - `PRICE_DATA_MISSING`: ベンチ銘柄の基準点価格が取得できない（データ欠落）。
 * - `NO_STRATEGY_EQUITY`: range 内の戦略エクイティ点が不足し同条件比較ができない。
 */
export const BenchmarkUnavailableReason = z.enum([
  "NOT_CONFIGURED",
  "PRICE_DATA_MISSING",
  "NO_STRATEGY_EQUITY",
]);
export type BenchmarkUnavailableReason = z.infer<
  typeof BenchmarkUnavailableReason
>;

/**
 * ベンチ比較の結果型（成立/不成立を表現可能な discriminated union）。
 *
 * 既存 `BenchmarkComparison`（成立時の数値のみ）は破壊せず据え置き、これは
 * 「比較不能」を理由付きで返せるラッパ。api は agent-trader の
 * `BenchmarkUnavailableError` を握り潰して `null` 化する代わりに、`available: false`
 * + `reason` を型付きでクライアントへ提示できる（spec §2.7 P1 ベンチ比較）。
 */
export const BenchmarkComparisonResult = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true), comparison: BenchmarkComparison }),
  z.object({
    available: z.literal(false),
    benchmark: BenchmarkId,
    reason: BenchmarkUnavailableReason,
  }),
]);
export type BenchmarkComparisonResult = z.infer<
  typeof BenchmarkComparisonResult
>;

// ── サービス契約（spec §6.6） ──

export interface RiskGuard {
  check(
    accountId: string,
    action: AgentAction,
  ): { ok: boolean; reason?: string };
}

export interface AgentTradingService {
  /** AI の発注。必ず decision を記録し、RiskGuard 通過後に TradingEngine へ委譲する。 */
  submitDecision(input: {
    agentProfileId: string;
    accountId: string;
    rationale: string;
    actions: AgentAction[];
    inputContext: unknown;
  }): Promise<{ decisionId: string; orders: Order[] }>;
  buildObservation(accountId: string): Promise<AgentObservation>;
}

export interface PerformanceEvaluator {
  snapshot(accountId: string, at: Date): Promise<PerformanceSnapshot>;
  /**
   * ベンチ比較。公正に成立しない場合は値を捏造せず throw する（spec §9）。
   * 理由を握って提示したい呼び出し側（api）は {@link compareResult} を使う。
   */
  compare(
    accountId: string,
    benchmark: BenchmarkId,
    range: { from: Date; to: Date },
  ): Promise<BenchmarkComparison>;
  /**
   * ベンチ比較の結果を「成立/不成立（理由付き）」として返す（throw しない）。
   * api はこれを使い、比較不能を `null` 化する代わりに理由をクライアントへ提示する
   * （spec §2.7 P1 ベンチ比較）。
   */
  compareResult(
    accountId: string,
    benchmark: BenchmarkId,
    range: { from: Date; to: Date },
  ): Promise<BenchmarkComparisonResult>;
}
