import { z } from "zod";
import {
  Currency,
  DecimalString,
  Id,
  Money,
  Quantity,
  Timestamp,
} from "./common.js";
import type { Instrument } from "./instrument.js";
import type { RealizedPnl } from "./ledger.js";
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
  /** 建玉の取引通貨（B3: 自己記述的にし instrument→currency マップ回避を不要にする）。 */
  currency: Currency,
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
 *
 * B2/B4 で読み取り系（取引履歴・実現損益）と入出金を正式契約化した。
 */
export interface PortfolioService {
  applyTrade(trade: Trade): Promise<void>;
  getPositions(accountId: string): Promise<PositionView[]>;
  getSummary(accountId: string): Promise<PortfolioSummary>;
  getHistory(
    accountId: string,
    range: { from: Date; to: Date },
  ): Promise<EquityPoint[]>;

  /**
   * 入金。現金残高と CashLedger(DEPOSIT) を整合更新する（B4）。
   * spec §2.6（JPY/USD 両建ての初期入金・資金供給）。
   */
  deposit(accountId: string, amount: Money, at?: Date): Promise<void>;
  /**
   * 出金。現金残高と CashLedger(WITHDRAW) を整合更新する（B4）。
   * 残高不足時は実装が DomainError("INSUFFICIENT_FUNDS") を投げる。
   */
  withdraw(accountId: string, amount: Money, at?: Date): Promise<void>;

  /** 取引履歴の一覧（時系列昇順。spec §6.8 GET /accounts/:id/trades。B2）。 */
  getTrades(accountId: string): Promise<Trade[]>;
  /** 実現損益（trade 単位）の一覧（agent-trader の勝率計算等に使う。B2）。 */
  getRealizedPnl(accountId: string): Promise<RealizedPnl[]>;
}

/**
 * 口座状態（現金/保有）の読み取り IF（B2）。
 *
 * trading-engine の発注前チェックや apps/api の結線が、PortfolioService 全体に
 * 依存せず最小限の読み取りだけを行うためのポート。実装は portfolio が提供する。
 */
export interface AccountStateProvider {
  /** 口座の指定通貨の利用可能現金（DecimalString。未登録は "0"）。 */
  getAvailableCash(accountId: string, currency: Currency): Promise<string>;
  /** 口座の指定銘柄の保有数量（未保有は 0）。 */
  getPositionQuantity(accountId: string, instrumentId: string): Promise<number>;
}

/**
 * 銘柄解決の最小 IF（B2）。
 *
 * symbol/通貨など Instrument の属性を id から解決する。agent-trader の
 * AgentObservation や portfolio の通貨導出が利用する。market-data を直接
 * import せず、この IF（実装は market-data / db）に依存する（spec §4.3）。
 */
export interface InstrumentResolver {
  /** 銘柄を id で解決する。未知なら null。 */
  getById(instrumentId: string): Promise<Instrument | null>;
}
