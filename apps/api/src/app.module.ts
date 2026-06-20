import { Module } from "@nestjs/common";
import { ConfigModule } from "./common/config.module.js";
import { PersistenceModule } from "./persistence/persistence.module.js";
import { MarketDataModule } from "./market-data/market-data.module.js";
import { PortfolioModule } from "./portfolio/portfolio.module.js";
import { TradingModule } from "./trading/trading.module.js";
import { AnalyticsModule } from "./analytics/analytics.module.js";
import { AgentModule } from "./agent/agent.module.js";

/**
 * apps/api ルートモジュール。各ドメインモジュールを DI でマウントする（spec §4.1）。
 * 依存方向（spec §4.3）: 各モジュールは contracts の IF 経由でのみ結合し、横依存を作らない。
 */
@Module({
  imports: [
    ConfigModule,
    PersistenceModule,
    MarketDataModule,
    PortfolioModule,
    TradingModule,
    AnalyticsModule,
    AgentModule,
  ],
})
export class AppModule {}
