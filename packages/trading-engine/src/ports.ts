import type { Order } from "@stonks/contracts";

/**
 * trading-engine 内部の最小ポート（依存性逆転）。
 *
 * 永続化（db）やポートフォリオ状態（portfolio）には直接依存せず、
 * ここで定義した IF に対して実装/フェイクを注入する（CLAUDE.md §0・§4.3）。
 * 実 DB / PortfolioService 結線は Phase 2 でアダプタを差し込む。
 */

/** 注文の永続化ポート。 */
export interface OrderRepository {
  /** 新規注文を保存する。 */
  save(order: Order): Promise<void>;
  /** id で 1 件取得。なければ null。 */
  findById(orderId: string): Promise<Order | null>;
  /** 評価対象になり得るオープン注文（PENDING / PARTIALLY_FILLED）を返す。 */
  findOpen(): Promise<Order[]>;
  /** 既存注文を更新する（状態遷移・約定数量の反映）。 */
  update(order: Order): Promise<void>;
}

/**
 * 事前チェック（現金/保有）のための口座状態の読み取りポート。
 * portfolio を import せず、必要最小限の読み取りのみを契約する。
 */
export interface AccountStateProvider {
  /** 口座の指定通貨の利用可能現金（DecimalString）。 */
  getAvailableCash(accountId: string, currency: string): Promise<string>;
  /** 口座の指定銘柄の保有数量。 */
  getPositionQuantity(accountId: string, instrumentId: string): Promise<number>;
}

/** Instrument の参照ポート（lotSize / tickRules / currency を解決）。 */
export interface InstrumentProvider {
  getById(instrumentId: string): Promise<import("@stonks/contracts").Instrument | null>;
}
