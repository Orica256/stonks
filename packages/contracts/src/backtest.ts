import { z } from "zod";
import { DateRange, DecimalString, Id, Timeframe, Timestamp } from "./common.js";
import { IndicatorSpec } from "./analytics.js";

/**
 * ルールベース戦略の定義（spec §2.5, §6.5）。
 * Phase 0 では契約のみ確定し、実装は Phase 3（backtest-dev）。
 */
export const StrategyRule = z.object({
  /** 評価式（例: "SMA(5) crossUp SMA(20)"）。実装で評価器を用意する。 */
  when: z.string(),
  action: z.enum(["BUY", "SELL", "CLOSE"]),
  /** 数量の決め方（固定株数 or 資産比率）。 */
  sizing: z.object({
    mode: z.enum(["FIXED_QTY", "EQUITY_PCT"]),
    value: z.number().positive(),
  }),
});
export type StrategyRule = z.infer<typeof StrategyRule>;

export const StrategyDef = z.object({
  id: Id.optional(),
  name: z.string(),
  universe: z.array(Id), // 対象銘柄
  timeframe: Timeframe,
  indicators: z.array(IndicatorSpec).default([]),
  rules: z.array(StrategyRule),
});
export type StrategyDef = z.infer<typeof StrategyDef>;

export const BacktestMetrics = z.object({
  totalReturn: z.number(),
  maxDrawdown: z.number(),
  sharpe: z.number(),
  winRate: z.number(),
  trades: z.number().int(),
});
export type BacktestMetrics = z.infer<typeof BacktestMetrics>;

export const BacktestResult = z.object({
  metrics: BacktestMetrics,
  /**
   * エクイティカーブ。`ts` は UTC ISO8601（`Timestamp`。EquityPoint.ts と同形式）。
   * 値は backtest runner が `Date#toISOString()` で生成する UTC 時刻のため、
   * 緩い `z.string()` から `Timestamp` へ締めても実行時等価（型表現の厳格化のみ）。
   */
  equityCurve: z.array(z.object({ ts: Timestamp, equity: DecimalString })),
});
export type BacktestResult = z.infer<typeof BacktestResult>;

export const RunBacktestRequest = z.object({
  strategy: StrategyDef,
  range: DateRange,
  initialCash: DecimalString,
});
export type RunBacktestRequest = z.infer<typeof RunBacktestRequest>;

/** backtest の公開契約（spec §6.5）。trading-engine の約定ロジックと analytics を再利用。 */
export interface BacktestRunner {
  run(req: RunBacktestRequest): Promise<BacktestResult>;
}
