import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  NotImplementedException,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import {
  type CorporateAction,
  type Instrument,
  type Market,
  type MarketDataProvider,
  type PriceBar,
  type Quote,
  Timeframe,
} from "@stonks/contracts";
import type { InstrumentProvider } from "@stonks/trading-engine";
import { TOKENS } from "../common/tokens.js";

/**
 * market-data の REST/SSE エンドポイント（spec §6.8）:
 *   GET /instruments?q=&market=
 *   GET /instruments/:id                              (単一銘柄取得。見つからなければ 404)
 *   GET /instruments/:id/bars?timeframe=&from=&to=
 *   GET /instruments/:id/quote
 *   GET /instruments/:id/corporate-actions?from=&to=  (配当/分割。spec §2.1 P1)
 *   GET /quotes/stream?ids=  (SSE)
 */
@Controller()
export class MarketDataController {
  constructor(
    @Inject(TOKENS.MarketData)
    private readonly market: MarketDataProvider & {
      getQuote(id: string): Promise<Quote>;
    },
    @Inject(TOKENS.InstrumentProvider)
    private readonly instruments: InstrumentProvider,
  ) {}

  @Get("instruments")
  async search(
    @Query("q") q?: string,
    @Query("market") market?: string,
  ): Promise<Instrument[]> {
    const m = market === "JP" || market === "US" ? (market as Market) : undefined;
    return this.market.searchInstruments(q ?? "", m);
  }

  /**
   * 単一銘柄を取得する（id は EXCHANGE:SYMBOL 形式の正準 ID）。
   * web の一覧（オープン注文・取引履歴等）で instrumentId を銘柄名・通貨付きで
   * 表示するための補助ルート。見つからなければ 404 を返す。
   *
   * 末尾サブパス（/bars, /quote, /corporate-actions）とは別パスのため衝突しない。
   */
  @Get("instruments/:id")
  async getById(@Param("id") id: string): Promise<Instrument> {
    const instrument = await this.instruments.getById(id);
    if (!instrument) {
      throw new NotFoundException(`instrument not found: ${id}`);
    }
    return instrument;
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
   * 配当/分割（コーポレートアクション）を取得する（spec §2.1 P1 / §6.1。spec §6.8 一覧外の補助ルート）。
   * `exDate` が `from`〜`to`（ISO 文字列クエリ・UTC）に入るものを返す。未指定時は直近 1 年。
   *
   * `getCorporateActions` は MarketDataProvider 契約上 optional（後方互換）。未対応プロバイダが
   * 注入された場合は、データを捏造せず 501 を返す（/bars 等のエラー方針＝縮退しつつ誤データを出さない）。
   */
  @Get("instruments/:id/corporate-actions")
  async corporateActions(
    @Param("id") id: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<CorporateAction[]> {
    if (!this.market.getCorporateActions) {
      throw new NotImplementedException(
        "corporate actions are not supported by this market-data provider",
      );
    }
    const now = new Date();
    const toTs = to ?? now.toISOString();
    const fromTs =
      from ?? new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    return this.market.getCorporateActions({
      instrumentId: id,
      from: fromTs,
      to: toTs,
    });
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
