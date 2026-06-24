import { z } from "zod";
import {
  Currency,
  Exchange,
  InstrumentId,
  InstrumentType,
  Market,
} from "./common.js";

/** 呼値（tick size）ルール: priceFrom 以上でこの刻みを使う、を昇順に並べる。 */
export const TickRule = z.object({
  priceFrom: z.string(), // DecimalString（境界価格）
  tickSize: z.string(), // DecimalString（刻み）
});
export type TickRule = z.infer<typeof TickRule>;

export const Instrument = z.object({
  /** 正準形式 `EXCHANGE:SYMBOL`（例 `TSE:7203` / `NASDAQ:AAPL`。spec §5.1 / B1）。 */
  id: InstrumentId,
  symbol: z.string().min(1), // 例: "7203"(TSE) / "AAPL"(NASDAQ)
  exchange: Exchange,
  market: Market,
  name: z.string(),
  currency: Currency,
  type: InstrumentType,
  /** 単元株数（東証は通常 100、米国は 1）。 */
  lotSize: z.number().int().positive(),
  /** 呼値ルール（昇順）。空なら任意刻み。 */
  tickRules: z.array(TickRule).default([]),
  isActive: z.boolean().default(true),
  /**
   * 信用買い建て（制度/一般信用での新規買建）が制度上可能か。銘柄マスタ由来。
   * 未指定(undefined)=不明。`MarginPolicyProvider.getMarginPolicy()=null`（ポリシー設定上の不可）
   * とは別レイヤ（こちらは銘柄そのものの貸借区分上の可否）。
   */
  marginTradable: z.boolean().optional(),
  /**
   * 信用売り建て（空売り＝貸借銘柄）が制度上可能か。銘柄マスタ由来。
   * 未指定(undefined)=不明。ポリシー設定上の可否（getMarginPolicy）とは別レイヤ。
   */
  shortMarginable: z.boolean().optional(),
});
export type Instrument = z.infer<typeof Instrument>;
