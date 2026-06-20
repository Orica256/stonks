import { Inject, Injectable } from "@nestjs/common";
import type {
  Order,
  PlaceOrderCommand,
  PortfolioService,
  PriceProvider,
  Trade,
} from "@stonks/contracts";
import type { StandardTradingEngine } from "@stonks/trading-engine";
import { TOKENS } from "../common/tokens.js";

/**
 * TradingEngine の薄いアプリ層ラッパ。
 *
 * 約定が出たら portfolio.applyTrade に流す結線をここで一元化する
 * （発注・取消は委譲、評価は評価後に約定を portfolio へ反映）。
 * 取引履歴は portfolio が applyTrade で記録するため、参照は
 * PortfolioService.getTrades に委譲する（B2: TradeLog ブリッジを廃止）。
 */
@Injectable()
export class TradingService {
  constructor(
    @Inject(TOKENS.TradingEngine)
    private readonly engine: StandardTradingEngine,
    @Inject(TOKENS.PortfolioService)
    private readonly portfolio: PortfolioService,
    @Inject(TOKENS.PriceProvider)
    private readonly priceProvider: PriceProvider,
  ) {}

  placeOrder(cmd: PlaceOrderCommand): Promise<Order> {
    return this.engine.placeOrder(cmd);
  }

  cancelOrder(orderId: string): Promise<Order> {
    return this.engine.cancelOrder(orderId);
  }

  /**
   * オープン注文を評価し、生成された約定を順に portfolio へ反映する。
   * 価格更新時・定期インターバル・明示エンドポイントから駆動される（最小実装）。
   */
  async evaluateOpenOrders(now: Date = new Date()): Promise<Trade[]> {
    const trades = await this.engine.evaluateOpenOrders({
      now,
      priceProvider: this.priceProvider,
    });
    for (const trade of trades) {
      await this.portfolio.applyTrade(trade);
    }
    return trades;
  }

  listTrades(accountId: string): Promise<Trade[]> {
    return this.portfolio.getTrades(accountId);
  }
}
