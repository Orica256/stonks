import Decimal from "decimal.js";
import type { Fill, FillModel, Order } from "@stonks/contracts";

/**
 * 約定モデル: 与えられた市場価格に対し注文が約定するか、約定価格はいくらかを判定する。
 *
 * - MARKET: 常に約定。スリッページを不利方向に適用（BUY は上方向、SELL は下方向）。
 * - LIMIT: 価格到達時のみ約定（BUY は market<=limit、SELL は market>=limit）。約定価格は指値（保守的）。
 * - STOP: トリガ済み前提で engine が市場注文として扱う（ここでは MARKET と同じ挙動）。
 * - STOP_LIMIT: トリガ済み前提で LIMIT として扱う。
 *
 * トリガ判定（stopPrice 到達）の状態管理は engine 側。FillModel は「今、約定するか」を純粋に評価する。
 * 数量は残数量（quantity - filledQuantity）を全量約定（部分約定の刻みは engine が制御）。
 */

export interface FillModelConfig {
  /** スリッページ率（約定価格に対する比率。DecimalString, 例 "0.001" = 10bps）。 */
  slippageRate: string;
}

export const DEFAULT_FILL_CONFIG: FillModelConfig = {
  slippageRate: "0.0005", // 5bps
};

/**
 * STOP / STOP_LIMIT は「トリガ済み」を engine が判断した上で、
 * このフラグ付きヘルパに委譲する。素の tryFill は契約準拠の入口。
 */
export class SlippageFillModel implements FillModel {
  private readonly config: FillModelConfig;

  constructor(config: FillModelConfig = DEFAULT_FILL_CONFIG) {
    this.config = config;
  }

  tryFill(order: Order, marketPrice: string): Fill | null {
    return this.tryFillTriggered(order, marketPrice, false);
  }

  /**
   * @param stopTriggered STOP / STOP_LIMIT が既にトリガ済みかどうか（engine が判断）。
   */
  tryFillTriggered(
    order: Order,
    marketPrice: string,
    stopTriggered: boolean,
  ): Fill | null {
    const remaining = order.quantity - order.filledQuantity;
    if (remaining <= 0) return null;

    const market = new Decimal(marketPrice);

    switch (order.type) {
      case "MARKET":
        return this.fill(remaining, this.applySlippage(market, order.side));

      case "LIMIT": {
        const fillPrice = this.limitFillPrice(order, market);
        return fillPrice ? this.fill(remaining, fillPrice) : null;
      }

      case "STOP":
        if (!stopTriggered) return null;
        return this.fill(remaining, this.applySlippage(market, order.side));

      case "STOP_LIMIT": {
        if (!stopTriggered) return null;
        const fillPrice = this.limitFillPrice(order, market);
        return fillPrice ? this.fill(remaining, fillPrice) : null;
      }

      default:
        return null;
    }
  }

  /** LIMIT 約定可否と約定価格（指値。価格未到達なら null）。 */
  private limitFillPrice(order: Order, market: Decimal): Decimal | null {
    if (order.limitPrice === undefined) return null;
    const limit = new Decimal(order.limitPrice);
    if (order.side === "BUY") {
      // 買い指値: 市場が指値以下なら約定（より有利な市場価格で約定）。
      return market.lessThanOrEqualTo(limit) ? market : null;
    }
    // 売り指値: 市場が指値以上なら約定。
    return market.greaterThanOrEqualTo(limit) ? market : null;
  }

  /** スリッページを不利方向に適用する。 */
  private applySlippage(market: Decimal, side: Order["side"]): Decimal {
    const rate = new Decimal(this.config.slippageRate);
    return side === "BUY"
      ? market.times(new Decimal(1).plus(rate))
      : market.times(new Decimal(1).minus(rate));
  }

  private fill(quantity: number, price: Decimal): Fill {
    return { quantity, price: price.toString() };
  }
}
