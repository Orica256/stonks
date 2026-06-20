import type {
  FxProvider,
  MarketDataProvider,
  Market,
} from "@stonks/contracts";
import { parseInstrumentId } from "@stonks/contracts";
import { isMarketOpen } from "@stonks/core-domain";
import type {
  BackfillBarsPayload,
  FetchFxRatePayload,
  PollQuotePayload,
} from "./jobs.js";
import type { IngestionRepository } from "./repository.js";

/**
 * 取込ハンドラ群（純粋・副作用は注入された port 経由のみ）。
 *
 * ワーカーはスケジューリングと永続化トリガに徹し、外部 API は market-data の
 * Provider IF 経由でのみ叩く（アダプタ層の内側に閉じ込める。CLAUDE.md §4）。
 * レート制御・フォールバックは market-data 側に委譲済み。
 */

/** ワーカーが必要とする market-data の公開 IF（registry が実装する）。 */
export type MarketDataPort = MarketDataProvider & FxProvider;

/** ハンドラ共通の依存。`now` はテスト用に注入可能。 */
export interface HandlerDeps {
  market: MarketDataPort;
  repo: IngestionRepository;
  now?: () => Date;
  logger?: Pick<Console, "info" | "warn">;
}

const EXCHANGE_TO_MARKET: Record<string, Market> = {
  TSE: "JP",
  NYSE: "US",
  NASDAQ: "US",
};

/** instrumentId(EXCHANGE:SYMBOL) から市場を導出する。 */
const marketOf = (instrumentId: string): Market | undefined => {
  const parsed = parseInstrumentId(instrumentId);
  return parsed ? EXCHANGE_TO_MARKET[parsed.exchange] : undefined;
};

/** 日足等の OHLCV バックフィル。取得したバーを upsert し件数を返す。 */
export const handleBackfillBars = async (
  deps: HandlerDeps,
  payload: BackfillBarsPayload,
): Promise<{ written: number }> => {
  const bars = await deps.market.getBars({
    instrumentId: payload.instrumentId,
    timeframe: payload.timeframe,
    from: payload.from,
    to: payload.to,
  });
  const written = await deps.repo.saveBars(bars);
  deps.logger?.info?.(
    `[backfill-bars] ${payload.instrumentId} ${payload.timeframe} ${payload.from}..${payload.to} -> ${written} bars`,
  );
  return { written };
};

/**
 * 最新気配ポーリング。
 *
 * 休場中は無料枠の呼び出しを節約するため既定でスキップする（force で強制）。
 * JP は EOD・遅延前提のため、休場時間帯でもこのジョブは低頻度で十分。
 */
export const handlePollQuote = async (
  deps: HandlerDeps,
  payload: PollQuotePayload,
): Promise<{ skipped: boolean }> => {
  const now = (deps.now ?? (() => new Date()))();
  const market = payload.market ?? marketOf(payload.instrumentId);
  if (!payload.force && market && !isMarketOpen(market, now)) {
    deps.logger?.info?.(
      `[poll-quote] ${payload.instrumentId} skipped (market ${market} closed)`,
    );
    return { skipped: true };
  }
  const quote = await deps.market.getQuote(payload.instrumentId);
  await deps.repo.saveQuote(quote);
  deps.logger?.info?.(
    `[poll-quote] ${payload.instrumentId} last=${quote.last} src=${quote.source}`,
  );
  return { skipped: false };
};

/** 為替（USD/JPY）取得。レートを保存する。 */
export const handleFetchFxRate = async (
  deps: HandlerDeps,
  payload: FetchFxRatePayload,
): Promise<{ rate: string }> => {
  const rate = await deps.market.getRate(payload.base, payload.quote);
  await deps.repo.saveFxRate(rate);
  deps.logger?.info?.(
    `[fetch-fx-rate] ${rate.base}/${rate.quote}=${rate.rate}`,
  );
  return { rate: rate.rate };
};
