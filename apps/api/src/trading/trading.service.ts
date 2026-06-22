import { Inject, Injectable } from "@nestjs/common";
import {
  DomainError,
  type Order,
  type PlaceBracketOrderCommand,
  type PlaceOrderCommand,
  type PortfolioService,
  type PriceProvider,
  type Trade,
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
   * 複合注文（OCO / IFD / bracket）の発注（Phase 5）。
   * 各 leg/parent/child は PlaceOrderCommand として trading-engine が個別検証し、
   * link を張った Order 群を返す。エンジンが optional メソッド未実装なら CONFLICT。
   */
  placeBracketOrder(cmd: PlaceBracketOrderCommand): Promise<Order[]> {
    if (!this.engine.placeBracketOrder) {
      throw new DomainError(
        "CONFLICT",
        "compound orders are not supported by the trading engine",
      );
    }
    return this.engine.placeBracketOrder(cmd);
  }

  /**
   * 複合注文グループ単位の取消（Phase 5）。
   * linkGroupId に属するオープン/WAITING 注文を一括取消し、取消後の Order 群を返す。
   */
  cancelOrderGroup(linkGroupId: string): Promise<Order[]> {
    if (!this.engine.cancelOrderGroup) {
      throw new DomainError(
        "CONFLICT",
        "order group cancellation is not supported by the trading engine",
      );
    }
    return this.engine.cancelOrderGroup(linkGroupId);
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
