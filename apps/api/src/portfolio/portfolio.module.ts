import { Module } from "@nestjs/common";
import {
  DefaultPortfolioService,
  type PortfolioRepository,
} from "@stonks/portfolio";
import type { FxProvider, PriceProvider } from "@stonks/contracts";
import { TOKENS } from "../common/tokens.js";
import type { AppConfig } from "../common/config.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { MarketDataModule } from "../market-data/market-data.module.js";
import { PortfolioController } from "./portfolio.controller.js";

/**
 * portfolio の結線。
 * PortfolioRepository は PersistenceModule、価格/為替は MarketDataModule（PriceProvider/FxProvider）から注入する。
 * baseCurrency は AppConfig 由来。
 */
@Module({
  imports: [PersistenceModule, MarketDataModule],
  controllers: [PortfolioController],
  providers: [
    {
      provide: TOKENS.PortfolioService,
      inject: [
        TOKENS.PortfolioRepository,
        TOKENS.PriceProvider,
        TOKENS.FxProvider,
        TOKENS.AppConfig,
      ],
      useFactory: (
        repository: PortfolioRepository,
        priceProvider: PriceProvider,
        fxProvider: FxProvider,
        config: AppConfig,
      ): DefaultPortfolioService =>
        new DefaultPortfolioService({
          repository,
          priceProvider,
          fxProvider,
          baseCurrency: config.baseCurrency,
        }),
    },
  ],
  exports: [TOKENS.PortfolioService],
})
export class PortfolioModule {}
