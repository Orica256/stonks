import { z } from "zod";
import {
  Currency,
  DecimalString,
  Id,
  Money,
  Quantity,
  Timestamp,
} from "./common.js";
import type { Trade } from "./trade.js";

export const PositionSide = z.enum(["LONG", "SHORT"]);
export type PositionSide = z.infer<typeof PositionSide>;

export const Position = z.object({
  id: Id,
  accountId: Id,
  instrumentId: Id,
  side: PositionSide.default("LONG"), // SHORT は信用（Phase 3）
  quantity: Quantity,
  avgCost: DecimalString, // 平均取得単価（建値）
  openedAt: Timestamp,
});
export type Position = z.infer<typeof Position>;

/** 評価額・含み損益を載せた表示用ビュー。 */
export const PositionView = Position.extend({
  marketPrice: DecimalString,
  marketValue: Money,
  unrealizedPnl: Money,
  unrealizedPnlPct: z.number(),
});
export type PositionView = z.infer<typeof PositionView>;

export const PortfolioSummary = z.object({
  accountId: Id,
  baseCurrency: Currency,
  cash: Money, // 基軸換算後の現金合計
  positionsValue: Money,
  equity: Money, // 総資産 = cash + positionsValue
  unrealizedPnl: Money,
  realizedPnl: Money,
});
export type PortfolioSummary = z.infer<typeof PortfolioSummary>;

export const EquityPoint = z.object({
  ts: Timestamp,
  equity: DecimalString,
});
export type EquityPoint = z.infer<typeof EquityPoint>;

/**
 * portfolio モジュールの公開契約（spec §6.3）。
 * 評価は PriceProvider 経由で行い market-data を直接 import しない。
 */
export interface PortfolioService {
  applyTrade(trade: Trade): Promise<void>;
  getPositions(accountId: string): Promise<PositionView[]>;
  getSummary(accountId: string): Promise<PortfolioSummary>;
  getHistory(
    accountId: string,
    range: { from: Date; to: Date },
  ): Promise<EquityPoint[]>;
}
