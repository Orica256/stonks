import { Module } from "@nestjs/common";
import type { MarketDataProvider } from "@stonks/contracts";
import type { InstrumentProvider } from "@stonks/trading-engine";
import { TOKENS } from "../common/tokens.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { MarketDataModule } from "../market-data/market-data.module.js";
import { BacktestController } from "./backtest.controller.js";
import { MarketDataBacktestRunnerFactory } from "./market-data-source.js";

/**
 * backtest の結線（spec §6.5 / §6.8）。
 *
 * BacktestRunner はリクエストの universe/range ごとにデータソースが変わるため、
 * 単一のシングルトン Runner ではなく、market-data（バー）と InstrumentProvider
 * （銘柄定義）を注入したファクトリを提供する。約定ロジック・指標は backtest
 * パッケージが trading-engine / analytics を再利用するため、ここでは追加結線しない。
 */
@Module({
  imports: [MarketDataModule, PersistenceModule],
  controllers: [BacktestController],
  providers: [
    {
      provide: TOKENS.BacktestRunnerFactory,
      inject: [TOKENS.MarketData, TOKENS.InstrumentProvider],
      useFactory: (
        market: MarketDataProvider,
        instruments: InstrumentProvider,
      ): MarketDataBacktestRunnerFactory =>
        new MarketDataBacktestRunnerFactory(market, instruments),
    },
  ],
  exports: [TOKENS.BacktestRunnerFactory],
})
export class BacktestModule {}
