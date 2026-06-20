import { Module } from "@nestjs/common";
import {
  DefaultAgentTradingService,
  DefaultPerformanceEvaluator,
  InMemoryAgentDecisionRepository,
  InMemoryPerformanceSnapshotRepository,
  type AgentDecisionRepository,
  type AgentProfileProvider,
  type BenchmarkConfig,
  type PerformanceSnapshotRepository,
} from "@stonks/agent-trader";
import type {
  PortfolioService,
  PriceProvider,
  TradingEngine,
} from "@stonks/contracts";
import { getPrisma } from "@stonks/db";
import { TOKENS } from "../common/tokens.js";
import type { AppConfig } from "../common/config.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { PortfolioModule } from "../portfolio/portfolio.module.js";
import { MarketDataModule } from "../market-data/market-data.module.js";
import { TradingModule } from "../trading/trading.module.js";
import { AgentController } from "./agent.controller.js";
import {
  InMemoryAgentProfileStore,
  PrismaAgentProfileStore,
  type AgentProfileStore,
} from "./agent-profile-store.js";
import { PrismaAgentDecisionRepository } from "./prisma-agent-decision.repository.js";
import { PrismaPerformanceSnapshotRepository } from "./prisma-performance-snapshot.repository.js";

/**
 * agent-trader の結線（spec §6.6 / §2.7）。
 *
 * - 永続化（AgentProfile / AgentDecision / PerformanceSnapshot）は DATABASE_URL があれば
 *   Prisma、無ければ in-memory に倒す（既存 trade-log / persistence と同じパターン）。
 * - AgentTradingService は TradingEngine / PortfolioService / PriceProvider の IF を注入し、
 *   ドメインを直接 import せず contracts 経由でのみ発注・状態取得する（spec §4.3 / §8）。
 * - PerformanceEvaluator はベンチ銘柄を AppConfig から受ける（未設定ベンチは compare 不可）。
 */
@Module({
  imports: [
    PersistenceModule,
    PortfolioModule,
    MarketDataModule,
    TradingModule,
  ],
  controllers: [AgentController],
  providers: [
    {
      provide: TOKENS.AgentProfileStore,
      inject: [TOKENS.AppConfig],
      useFactory: (config: AppConfig): AgentProfileStore =>
        config.useDatabase
          ? new PrismaAgentProfileStore(getPrisma())
          : new InMemoryAgentProfileStore(),
    },
    {
      provide: TOKENS.AgentDecisionRepository,
      inject: [TOKENS.AppConfig],
      useFactory: (config: AppConfig): AgentDecisionRepository =>
        config.useDatabase
          ? new PrismaAgentDecisionRepository(getPrisma())
          : new InMemoryAgentDecisionRepository(),
    },
    {
      provide: TOKENS.PerformanceSnapshotRepository,
      inject: [TOKENS.AppConfig],
      useFactory: (config: AppConfig): PerformanceSnapshotRepository =>
        config.useDatabase
          ? new PrismaPerformanceSnapshotRepository(getPrisma())
          : new InMemoryPerformanceSnapshotRepository(),
    },
    {
      provide: TOKENS.AgentTradingService,
      inject: [
        TOKENS.AgentProfileStore,
        TOKENS.PortfolioService,
        TOKENS.PriceProvider,
        TOKENS.TradingEngine,
        TOKENS.AgentDecisionRepository,
      ],
      useFactory: (
        profiles: AgentProfileProvider,
        portfolio: PortfolioService,
        priceProvider: PriceProvider,
        tradingEngine: TradingEngine,
        decisions: AgentDecisionRepository,
      ): DefaultAgentTradingService =>
        new DefaultAgentTradingService({
          profiles,
          portfolio,
          priceProvider,
          tradingEngine,
          decisions,
        }),
    },
    {
      provide: TOKENS.PerformanceEvaluator,
      inject: [
        TOKENS.PortfolioService,
        TOKENS.PriceProvider,
        TOKENS.PerformanceSnapshotRepository,
        TOKENS.AppConfig,
      ],
      useFactory: (
        portfolio: PortfolioService,
        priceProvider: PriceProvider,
        snapshots: PerformanceSnapshotRepository,
        config: AppConfig,
      ): DefaultPerformanceEvaluator => {
        const benchmark: BenchmarkConfig = {
          ...(config.benchmarkInstruments.buyAndHold
            ? { buyAndHoldInstrumentId: config.benchmarkInstruments.buyAndHold }
            : {}),
          indexInstrumentId: {
            ...(config.benchmarkInstruments.topix
              ? { TOPIX: config.benchmarkInstruments.topix }
              : {}),
            ...(config.benchmarkInstruments.sp500
              ? { SP500: config.benchmarkInstruments.sp500 }
              : {}),
          },
        };
        return new DefaultPerformanceEvaluator({
          portfolio,
          priceProvider,
          snapshots,
          benchmark,
        });
      },
    },
  ],
  exports: [
    TOKENS.AgentTradingService,
    TOKENS.PerformanceEvaluator,
    TOKENS.AgentProfileStore,
    TOKENS.AgentDecisionRepository,
    TOKENS.PerformanceSnapshotRepository,
  ],
})
export class AgentModule {}
