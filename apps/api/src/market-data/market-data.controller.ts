import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import {
  type Instrument,
  type Market,
  type MarketDataProvider,
  type PriceBar,
  type Quote,
  Timeframe,
} from "@stonks/contracts";
import { TOKENS } from "../common/tokens.js";

/**
 * market-data の REST/SSE エンドポイント（spec §6.8）:
 *   GET /instruments?q=&market=
 *   GET /instruments/:id/bars?timeframe=&from=&to=
 *   GET /instruments/:id/quote
 *   GET /quotes/stream?ids=  (SSE)
 */
@Controller()
export class MarketDataController {
  constructor(
    @Inject(TOKENS.MarketData)
    private readonly market: MarketDataProvider & {
      getQuote(id: string): Promise<Quote>;
    },
  ) {}

  @Get("instruments")
  async search(
    @Query("q") q?: string,
    @Query("market") market?: string,
  ): Promise<Instrument[]> {
    const m = market === "JP" || market === "US" ? (market as Market) : undefined;
    return this.market.searchInstruments(q ?? "", m);
  }

  @Get("instruments/:id/bars")
  async bars(
    @Param("id") id: string,
    @Query("timeframe") timeframe?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<PriceBar[]> {
    const tf = Timeframe.parse(timeframe ?? "1d");
    const now = new Date();
    const toTs = to ?? now.toISOString();
    const fromTs =
      from ?? new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    return this.market.getBars({
      instrumentId: id,
      timeframe: tf,
      from: fromTs,
      to: toTs,
    });
  }

  @Get("instruments/:id/quote")
  async quote(@Param("id") id: string): Promise<Quote> {
    return this.market.getQuote(id);
  }

  /**
   * 価格ストリーム（SSE）。ids（カンマ区切り）の最新気配を一定間隔でポーリングし配信する。
   * 真のリアルタイム配信は無料制約により採用せず、短間隔ポーリングで近似する（spec §1.3）。
   */
  @Get("quotes/stream")
  stream(@Query("ids") ids: string | undefined, @Res() res: Response): void {
    const idList = (ids ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const intervalMs = 5000;
    const tick = async (): Promise<void> => {
      for (const id of idList) {
        try {
          const quote = await this.market.getQuote(id);
          res.write(`event: quote\ndata: ${JSON.stringify(quote)}\n\n`);
        } catch {
          // 1 銘柄の失敗で全体を止めない（縮退）。
        }
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    res.on("close", () => {
      clearInterval(timer);
      res.end();
    });
  }
}
