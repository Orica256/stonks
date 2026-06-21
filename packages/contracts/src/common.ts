import { z } from "zod";

/**
 * 共通プリミティブ。すべてのドメインスキーマがここを基盤にする。
 * 金額は浮動小数を使わず Decimal 文字列で表現する（CLAUDE.md §0）。
 */

// ── 列挙 ──
export const Market = z.enum(["JP", "US"]);
export type Market = z.infer<typeof Market>;

export const Exchange = z.enum(["TSE", "NYSE", "NASDAQ"]);
export type Exchange = z.infer<typeof Exchange>;

export const Currency = z.enum(["JPY", "USD"]);
export type Currency = z.infer<typeof Currency>;

export const InstrumentType = z.enum(["STOCK", "ETF"]);
export type InstrumentType = z.infer<typeof InstrumentType>;

export const Timeframe = z.enum(["1m", "5m", "15m", "1h", "1d"]);
export type Timeframe = z.infer<typeof Timeframe>;

// ── ID ──
export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

/**
 * 銘柄 ID の正準形式 `EXCHANGE:SYMBOL`（例 `TSE:7203`, `NASDAQ:AAPL`）。
 *
 * spec §5.1 の論理モデルでは `Instrument` は (exchange, symbol) で一意。これを
 * プロバイダ非依存の安定キーとして `EXCHANGE:SYMBOL` に結合したものを `Instrument.id`
 * の正準形式とする（CLAUDE.md §0「契約が唯一の真実」）。db の `Instrument.id`・
 * market-data のアダプタ・apps/api の結線すべてがこの形式を共有する。
 */
export const InstrumentId = z
  .string()
  .regex(
    /^(TSE|NYSE|NASDAQ):[A-Z0-9.-]+$/,
    "must be EXCHANGE:SYMBOL (e.g. TSE:7203, NASDAQ:AAPL)",
  );
export type InstrumentId = z.infer<typeof InstrumentId>;

/** `EXCHANGE:SYMBOL` を組み立てる（symbol は大文字化）。 */
export const buildInstrumentId = (exchange: Exchange, symbol: string): string =>
  `${exchange}:${symbol.toUpperCase()}`;

/** `EXCHANGE:SYMBOL` を分解する。形式不正なら null。 */
export const parseInstrumentId = (
  instrumentId: string,
): { exchange: Exchange; symbol: string } | null => {
  const idx = instrumentId.indexOf(":");
  if (idx <= 0) return null;
  const exchange = instrumentId.slice(0, idx);
  const symbol = instrumentId.slice(idx + 1);
  if (!symbol || !Exchange.options.includes(exchange as Exchange)) return null;
  return { exchange: exchange as Exchange, symbol };
};

// ── 金額（Decimal 文字列。演算は core-domain の Money ユーティリティ経由） ──
export const DecimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be a decimal string (no float)");
export type DecimalString = z.infer<typeof DecimalString>;

export const Money = z.object({
  amount: DecimalString,
  currency: Currency,
});
export type Money = z.infer<typeof Money>;

/** 数量（株数）。単元・端株は instrument 側のルールで検証する。 */
export const Quantity = z.number().finite().nonnegative();
export type Quantity = z.infer<typeof Quantity>;

// ── 時刻（すべて UTC・ISO8601。CLAUDE.md §0） ──
export const Timestamp = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

// ── ページング ──
export const Page = z.object({
  limit: z.number().int().positive().max(500).default(100),
  cursor: z.string().optional(),
});
export type Page = z.infer<typeof Page>;

export const DateRange = z.object({
  from: Timestamp,
  to: Timestamp,
});
export type DateRange = z.infer<typeof DateRange>;
