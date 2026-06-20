import { z } from "zod";
import { InstrumentId, Market, Timeframe, Timestamp } from "@stonks/contracts";

/**
 * 取込ジョブの種別とペイロードスキーマ（apps/ingestion-worker 内部契約）。
 *
 * これらは BullMQ のジョブ名・データの形であり、ドメイン契約ではないため
 * packages/contracts には置かず本アプリ内に閉じる。各ハンドラは
 * 必ず market-data の Provider IF 経由でデータを取得する（外部 API を直接叩かない）。
 */

/** 単一キューに相乗りし、ジョブ名で種別を判別する。 */
export const QUEUE_NAME = "ingestion";

export const JOB = {
  /** 日足 OHLCV のバックフィル（期間指定でヒストリカルを埋める）。 */
  BackfillBars: "backfill-bars",
  /** 最新気配ポーリング（US 準リアルタイム / JP は EOD・遅延）。 */
  PollQuote: "poll-quote",
  /** 為替レート（USD/JPY）取得。 */
  FetchFxRate: "fetch-fx-rate",
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

/** 日足バックフィル: 指定銘柄の [from, to] を timeframe で取り込み保存する。 */
export const BackfillBarsPayload = z.object({
  instrumentId: InstrumentId,
  timeframe: Timeframe.default("1d"),
  from: Timestamp,
  to: Timestamp,
});
export type BackfillBarsPayload = z.infer<typeof BackfillBarsPayload>;

/** 最新気配ポーリング: 1 銘柄の現在気配を取得し Quote として保存する。 */
export const PollQuotePayload = z.object({
  instrumentId: InstrumentId,
  /**
   * 市場が閉じていてもスキップせず取得するか。
   * 既定 false（休場中はプロバイダ呼び出しを節約し縮退する）。
   */
  force: z.boolean().default(false),
  /** 取引時間判定に使う市場（省略時は instrumentId から導出）。 */
  market: Market.optional(),
});
export type PollQuotePayload = z.infer<typeof PollQuotePayload>;

/** 為替取得: USD/JPY の最新レートを取得し保存する。 */
export const FetchFxRatePayload = z.object({
  base: z.literal("USD").default("USD"),
  quote: z.literal("JPY").default("JPY"),
});
export type FetchFxRatePayload = z.infer<typeof FetchFxRatePayload>;

/** ジョブ名 → ペイロードスキーマの対応表（ディスパッチ時のバリデーションに使う）。 */
export const JOB_PAYLOADS = {
  [JOB.BackfillBars]: BackfillBarsPayload,
  [JOB.PollQuote]: PollQuotePayload,
  [JOB.FetchFxRate]: FetchFxRatePayload,
} as const;
