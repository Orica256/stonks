import { z } from "zod";
import {
  DecimalString,
  Id,
  Market,
  Money,
  Timeframe,
  Timestamp,
} from "./common.js";
import { Instrument } from "./instrument.js";

export const Quote = z.object({
  instrumentId: Id,
  last: DecimalString,
  bid: DecimalString.optional(),
  ask: DecimalString.optional(),
  ts: Timestamp,
  source: z.string(), // 取得元プロバイダ名
});
export type Quote = z.infer<typeof Quote>;

export const PriceBar = z.object({
  instrumentId: Id,
  timeframe: Timeframe,
  ts: Timestamp, // バーの開始時刻（UTC）
  open: DecimalString,
  high: DecimalString,
  low: DecimalString,
  close: DecimalString,
  volume: z.number().nonnegative(),
});
export type PriceBar = z.infer<typeof PriceBar>;

export const CorporateAction = z.object({
  instrumentId: Id,
  type: z.enum(["DIVIDEND", "SPLIT"]),
  exDate: Timestamp,
  value: DecimalString, // 配当額 or 分割比率
});
export type CorporateAction = z.infer<typeof CorporateAction>;

export const FxRate = z.object({
  base: z.literal("USD"),
  quote: z.literal("JPY"),
  rate: DecimalString,
  ts: Timestamp,
});
export type FxRate = z.infer<typeof FxRate>;

export const GetBarsRequest = z.object({
  instrumentId: Id,
  timeframe: Timeframe,
  from: Timestamp,
  to: Timestamp,
});
export type GetBarsRequest = z.infer<typeof GetBarsRequest>;

/**
 * market-data モジュールが実装する公開契約（spec §6.1）。
 * 外部 API の差異はこの実装の内側に閉じ込める。
 */
export interface MarketDataProvider {
  searchInstruments(q: string, market?: Market): Promise<Instrument[]>;
  getQuote(instrumentId: string): Promise<Quote>;
  getBars(req: GetBarsRequest): Promise<PriceBar[]>;
}

/**
 * 他モジュールが価格を得る最小インターフェース（依存性逆転の要）。
 * trading-engine / portfolio / agent-trader はこれにのみ依存する。
 */
export interface PriceProvider {
  /** at を省略すると最新値。ヒストリカル実装では at 時点の価格を返す。 */
  getLatestPrice(instrumentId: string, at?: Date): Promise<Money>;
}

/** 為替換算の最小インターフェース。 */
export interface FxProvider {
  getRate(base: "USD", quote: "JPY", at?: Date): Promise<FxRate>;
}
