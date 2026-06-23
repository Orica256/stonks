import { Module } from "@nestjs/common";
import { createMarketDataProvider } from "@stonks/market-data";
import { TOKENS } from "../common/tokens.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { MarketDataController } from "./market-data.controller.js";

/**
 * market-data の結線。createMarketDataProvider が env からアダプタ構成を組み立てる
 * （Finnhub/J-Quants は鍵があれば、無ければ Yahoo で動作。FX は exchangerate.host）。
 *
 * 返る MarketDataRegistry は MarketDataProvider / PriceProvider / FxProvider を
 * 一体で満たすため、3 トークンとも同一インスタンスを指す（依存性逆転の供給点）。
 *
 * 単一銘柄取得（GET /instruments/:id）用に TOKENS.InstrumentProvider を解決するため
 * PersistenceModule を import する（InstrumentProvider はそこで供給・export 済み）。
 */
@Module({
  imports: [PersistenceModule],
  controllers: [MarketDataController],
  providers: [
    {
      provide: TOKENS.MarketData,
      useFactory: () => createMarketDataProvider({ env: process.env }),
    },
    {
      provide: TOKENS.PriceProvider,
      inject: [TOKENS.MarketData],
      useFactory: (md: unknown) => md,
    },
    {
      provide: TOKENS.FxProvider,
      inject: [TOKENS.MarketData],
      useFactory: (md: unknown) => md,
    },
  ],
  exports: [TOKENS.MarketData, TOKENS.PriceProvider, TOKENS.FxProvider],
})
export class MarketDataModule {}
