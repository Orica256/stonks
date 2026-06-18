import { Module } from "@nestjs/common";
import {
  InMemoryOrderRepository,
  InMemoryInstrumentProvider,
  type OrderRepository,
  type InstrumentProvider,
} from "@stonks/trading-engine";
import {
  InMemoryPortfolioRepository,
  type PortfolioRepository,
} from "@stonks/portfolio";
import { getPrisma } from "@stonks/db";
import { TOKENS } from "../common/tokens.js";
import type { AppConfig } from "../common/config.js";
import { PrismaOrderRepository } from "./prisma-order.repository.js";
import { PrismaInstrumentProvider } from "./prisma-instrument.provider.js";
import { PrismaPortfolioRepository } from "./prisma-portfolio.repository.js";
import { PortfolioAccountStateProvider } from "./portfolio-account-state.js";

/**
 * 永続化レイヤの結線。
 *
 * - DATABASE_URL があれば Prisma バックのリポジトリ（本番）。
 * - 無ければ in-memory 実装（ローカル開発・テスト相当）。
 * AccountStateProvider は常に PortfolioRepository へのブリッジで構成し、
 * trading-engine の現金/保有チェックを portfolio の状態に一致させる。
 */
@Module({
  providers: [
    {
      provide: TOKENS.PortfolioRepository,
      inject: [TOKENS.AppConfig],
      useFactory: (config: AppConfig): PortfolioRepository =>
        config.useDatabase
          ? new PrismaPortfolioRepository(getPrisma())
          : new InMemoryPortfolioRepository(),
    },
    {
      provide: TOKENS.OrderRepository,
      inject: [TOKENS.AppConfig],
      useFactory: (config: AppConfig): OrderRepository =>
        config.useDatabase
          ? new PrismaOrderRepository(getPrisma())
          : new InMemoryOrderRepository(),
    },
    {
      provide: TOKENS.InstrumentProvider,
      inject: [TOKENS.AppConfig],
      useFactory: (config: AppConfig): InstrumentProvider =>
        config.useDatabase
          ? new PrismaInstrumentProvider(getPrisma())
          : new InMemoryInstrumentProvider(),
    },
    {
      provide: TOKENS.AccountStateProvider,
      inject: [TOKENS.PortfolioRepository],
      useFactory: (repo: PortfolioRepository): PortfolioAccountStateProvider =>
        new PortfolioAccountStateProvider(repo),
    },
  ],
  exports: [
    TOKENS.PortfolioRepository,
    TOKENS.OrderRepository,
    TOKENS.InstrumentProvider,
    TOKENS.AccountStateProvider,
  ],
})
export class PersistenceModule {}
