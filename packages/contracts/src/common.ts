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
