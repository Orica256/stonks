import {
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  StandardFeeModel,
  StandardTradingEngine,
  SlippageFillModel,
  type AccountStateProvider,
  type InstrumentProvider,
  type OrderRepository,
} from "@stonks/trading-engine";
import type { MarginPolicyProvider } from "@stonks/contracts";
import { TOKENS } from "../common/tokens.js";
import type { AppConfig } from "../common/config.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { PortfolioModule } from "../portfolio/portfolio.module.js";
import { MarketDataModule } from "../market-data/market-data.module.js";
import { TradingService } from "./trading.service.js";
import { OrdersController } from "./orders.controller.js";
import { ConfigMarginPolicyProvider } from "./config-margin-policy.provider.js";

/**
 * オープン注文の定期評価ループ（任意。ORDER_EVAL_INTERVAL_MS > 0 で有効）。
 * 価格更新時の駆動を簡易に「一定間隔でのポーリング評価」で代替する最小実装。
 */
@Injectable()
class OrderEvaluationScheduler
  implements OnModuleInit, OnApplicationShutdown
{
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(TOKENS.AppConfig) private readonly config: AppConfig,
    private readonly trading: TradingService,
  ) {}

  onModuleInit(): void {
    if (this.config.orderEvalIntervalMs > 0) {
      this.timer = setInterval(() => {
        void this.trading.evaluateOpenOrders().catch(() => {
          // 評価失敗はループを止めない（次回再試行）。
        });
      }, this.config.orderEvalIntervalMs);
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

/**
 * trading-engine の結線。
 * OrderRepository / AccountStateProvider / InstrumentProvider は PersistenceModule から、
 * FeeModel / FillModel は既定実装を使い、StandardTradingEngine を組み立てる。
 */
@Module({
  imports: [PersistenceModule, PortfolioModule, MarketDataModule],
  controllers: [OrdersController],
  providers: [
    // 信用（MARGIN）発注の保証金/金利規定値プロバイダ（config 由来。未配線だと
    // trading-engine が MARGIN を一律拒否するため、ここで配線して受理可能にする）。
    {
      provide: TOKENS.MarginPolicyProvider,
      useClass: ConfigMarginPolicyProvider,
    },
    {
      provide: TOKENS.TradingEngine,
      inject: [
        TOKENS.OrderRepository,
        TOKENS.AccountStateProvider,
        TOKENS.InstrumentProvider,
        TOKENS.MarginPolicyProvider,
      ],
      useFactory: (
        orders: OrderRepository,
        accountState: AccountStateProvider,
        instruments: InstrumentProvider,
        marginPolicy: MarginPolicyProvider,
      ): StandardTradingEngine =>
        new StandardTradingEngine({
          orders,
          accountState,
          instruments,
          feeModel: new StandardFeeModel(),
          fillModel: new SlippageFillModel(),
          // 信用ポリシーを注入することで MARGIN 発注の保証金充足判定が有効化される。
          marginPolicy,
        }),
    },
    TradingService,
    OrderEvaluationScheduler,
  ],
  exports: [TradingService, TOKENS.TradingEngine],
})
export class TradingModule {}
