import { Module } from "@nestjs/common";
import { createIndicatorService } from "@stonks/analytics";
import { TOKENS } from "../common/tokens.js";
import { MarketDataModule } from "../market-data/market-data.module.js";
import { AnalyticsController } from "./analytics.controller.js";

/**
 * analytics の結線。IndicatorService は純粋関数（DB/ネットワーク非依存）。
 * バーは MarketDataModule から取得し、指標計算はこのサービスへ委譲する。
 */
@Module({
  imports: [MarketDataModule],
  controllers: [AnalyticsController],
  providers: [
    {
      provide: TOKENS.IndicatorService,
      useFactory: () => createIndicatorService(),
    },
  ],
  exports: [TOKENS.IndicatorService],
})
export class AnalyticsModule {}
