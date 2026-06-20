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
});
export type Instrument = z.infer<typeof Instrument>;
