import { z } from "zod";
import type {
  Market,
  Money} from "./common.js";
import {
  DecimalString,
  Id,
  Timeframe,
  Timestamp,
} from "./common.js";
import type { Instrument } from "./instrument.js";

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
 * 配当/分割（コーポレートアクション）取得リクエスト（B12。spec §6.1）。
 * `from`/`to` は UTC。`exDate` がこの期間に入る `CorporateAction` を取得する。
 */
export const GetCorporateActionsRequest = z.object({
  instrumentId: Id,
  from: Timestamp,
  to: Timestamp,
});
export type GetCorporateActionsRequest = z.infer<
  typeof GetCorporateActionsRequest
>;

/**
 * market-data モジュールが実装する公開契約（spec §6.1）。
 * 外部 API の差異はこの実装の内側に閉じ込める。
 */
export interface MarketDataProvider {
  searchInstruments(q: string, market?: Market): Promise<Instrument[]>;
  getQuote(instrumentId: string): Promise<Quote>;
  getBars(req: GetBarsRequest): Promise<PriceBar[]>;

  /**
   * 配当/分割（コーポレートアクション）を取得する（B12。spec §6.1）。
   * `exDate` が `req.from`〜`req.to`（UTC）に入るものを返す。
   *
   * 後方互換のため optional。既存の MarketDataProvider 実装（market-data の
   * MarketDataRegistry / apps の フェイク）はこのメソッドを持たないため必須化すると
   * 壊れる。実装可能なアダプタ/プロバイダのみが提供する（未提供は ingestion 側で
   * スキップ or フォールバック）。提供アダプタが揃ったら必須化を domain-architect と検討。
   */
  getCorporateActions?(
    req: GetCorporateActionsRequest,
  ): Promise<CorporateAction[]>;
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
