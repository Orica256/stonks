import {
  Controller,
  Get,
  Inject,
  NotImplementedException,
  Param,
  Query,
} from "@nestjs/common";
import type {
  CapitalGainsTaxEstimate,
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
 *   GET /accounts/:id/tax?from=&to=   (譲渡益課税の概算。spec §2.3 P1)
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

  /**
   * 譲渡益課税の「概算」を通貨別に返す（spec §2.3 P1。Phase 3）。
   * portfolio の `estimateCapitalGainsTax` に委譲し、契約型 `CapitalGainsTaxEstimate[]`
   * をそのまま返す（web も同型を消費＝形ズレ回避）。**これは確定申告の正確計算ではなく
   * 概算**（CLAUDE.md §7 免責）。免責表示は web 側の責務で、ここは値のみ返す。
   *
   * `from`/`to` は ISO 文字列クエリ（UTC）。未指定時は年初来（その年の 1/1 0:00 UTC〜現在）
   * を既定とする。`estimateCapitalGainsTax` は契約上 optional のため、未実装の実装が
   * 注入された場合は 501 を返す（既定の DefaultPortfolioService は実装済み）。
   */
  @Get("tax")
  tax(
    @Param("id") accountId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<CapitalGainsTaxEstimate[]> {
    if (!this.portfolio.estimateCapitalGainsTax) {
      throw new NotImplementedException(
        "capital gains tax estimation is not supported by this portfolio service",
      );
    }
    const now = new Date();
    const toDate = to ? new Date(to) : now;
    const fromDate = from
      ? new Date(from)
      : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return this.portfolio.estimateCapitalGainsTax(accountId, {
      from: fromDate,
      to: toDate,
    });
  }
}
