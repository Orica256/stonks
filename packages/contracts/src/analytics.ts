import { z } from "zod";
import type { PriceBar } from "./market-data.js";

export const IndicatorKind = z.enum([
  "SMA",
  "EMA",
  "RSI",
  "MACD",
  "BBANDS",
  "VOLUME",
]);
export type IndicatorKind = z.infer<typeof IndicatorKind>;

export const IndicatorSpec = z.object({
  kind: IndicatorKind,
  /** 期間等のパラメータ（例: { period: 14 } / MACD: { fast, slow, signal }）。 */
  params: z.record(z.number()).default({}),
});
export type IndicatorSpec = z.infer<typeof IndicatorSpec>;

/** 指標 1 本の時系列（null は計算不能な先頭区間）。 */
export const IndicatorSeries = z.object({
  name: z.string(), // 例: "SMA(20)" / "MACD.signal"
  values: z.array(z.number().nullable()),
});
export type IndicatorSeries = z.infer<typeof IndicatorSeries>;

export const IndicatorResult = z.object({
  /** 入力バーの ts 列（values と同じ長さ）。 */
  ts: z.array(z.string()),
  series: z.array(IndicatorSeries),
});
export type IndicatorResult = z.infer<typeof IndicatorResult>;

/**
 * analytics の公開契約（spec §6.4）。純粋関数: 副作用なし・DB/ネットワーク非依存。
 */
export interface IndicatorService {
  compute(req: {
    bars: PriceBar[];
    indicators: IndicatorSpec[];
  }): IndicatorResult;
}
