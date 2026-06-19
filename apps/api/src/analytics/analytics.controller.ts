import { Body, Controller, Inject, Param, Post } from "@nestjs/common";
import { z } from "zod";
import {
  type IndicatorResult,
  type IndicatorService,
  IndicatorSpec,
  type MarketDataProvider,
  Timeframe,
} from "@stonks/contracts";
import { TOKENS } from "../common/tokens.js";

const IndicatorsRequest = z.object({
  timeframe: Timeframe.default("1d"),
  from: z.string().optional(),
  to: z.string().optional(),
  indicators: z.array(IndicatorSpec).min(1),
});

/**
 * 分析 REST エンドポイント（spec §6.4 / §6.8 拡張）:
 *   POST /instruments/:id/indicators  バー取得→指標計算
 *
 * body: { timeframe?, from?, to?, indicators: IndicatorSpec[] }
 */
@Controller()
export class AnalyticsController {
  constructor(
    @Inject(TOKENS.MarketData)
    private readonly market: MarketDataProvider,
    @Inject(TOKENS.IndicatorService)
    private readonly indicators: IndicatorService,
  ) {}

  @Post("instruments/:id/indicators")
  async compute(
    @Param("id") instrumentId: string,
    @Body() body: unknown,
  ): Promise<IndicatorResult> {
    const req = IndicatorsRequest.parse(body ?? {});
    const now = new Date();
    const to = req.to ?? now.toISOString();
    const from =
      req.from ?? new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const bars = await this.market.getBars({
      instrumentId,
      timeframe: req.timeframe,
      from,
      to,
    });
    return this.indicators.compute({ bars, indicators: req.indicators });
  }
}
