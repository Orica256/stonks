import type { Money } from "./common.js";
import type { Instrument } from "./instrument.js";
import type { PriceProvider } from "./market-data.js";
import type { Order, PlaceOrderCommand } from "./order.js";
import type { Fill, Trade } from "./trade.js";

/** 手数料モデル（市場別。spec §6.2）。 */
export interface FeeModel {
  calculate(input: {
    instrument: Instrument;
    side: Order["side"];
    quantity: number;
    price: string; // DecimalString
  }): { fee: Money };
}

/** 約定モデル（成行/指値の約定判定とスリッページ）。 */
export interface FillModel {
  tryFill(order: Order, marketPrice: string): Fill | null;
}

/**
 * trading-engine の公開契約（spec §6.2）。
 * 価格は PriceProvider 経由で取得し market-data を直接 import しない。
 */
export interface TradingEngine {
  placeOrder(cmd: PlaceOrderCommand): Promise<Order>;
  cancelOrder(orderId: string): Promise<Order>;
  /** 価格更新時にオープン注文を評価し、約定（Trade）を生成する。 */
  evaluateOpenOrders(ctx: {
    now: Date;
    priceProvider: PriceProvider;
  }): Promise<Trade[]>;
}
