import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import type {
  EquityPoint,
  PortfolioService,
  PortfolioSummary,
  PositionView,
} from "@stonks/contracts";
import { TOKENS } from "../common/tokens.js";

/**
 * ポートフォリオ REST エンドポイント（spec §6.8）:
 *   GET /accounts/:id/positions
 *   GET /accounts/:id/summary
 *   GET /accounts/:id/history?from=&to=
 */
@Controller("accounts/:id")
export class PortfolioController {
  constructor(
    @Inject(TOKENS.PortfolioService)
    private readonly portfolio: PortfolioService,
  ) {}

  @Get("positions")
  positions(@Param("id") accountId: string): Promise<PositionView[]> {
    return this.portfolio.getPositions(accountId);
  }

  @Get("summary")
  summary(@Param("id") accountId: string): Promise<PortfolioSummary> {
    return this.portfolio.getSummary(accountId);
  }

  @Get("history")
  history(
    @Param("id") accountId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<EquityPoint[]> {
    const now = new Date();
    const toDate = to ? new Date(to) : now;
    const fromDate = from
      ? new Date(from)
      : new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    return this.portfolio.getHistory(accountId, { from: fromDate, to: toDate });
  }
}
