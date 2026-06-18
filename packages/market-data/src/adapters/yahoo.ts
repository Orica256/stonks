import type {
  GetBarsRequest,
  Instrument,
  Market,
  PriceBar,
  Quote,
  Timeframe,
} from "@stonks/contracts";
import { DomainError } from "@stonks/contracts";
import type { AdapterDeps, ProviderAdapter } from "../types.js";
import { defaultFetch, getJson, type FetchFn } from "../http.js";
import { RateLimiter } from "../rate-limiter.js";
import { toDecimalString, epochSecToIso } from "../decimal-util.js";
import {
  buildInstrumentId,
  fromYahooSymbol,
  parseInstrumentId,
  toYahooSymbol,
  type ParsedInstrumentId,
} from "../symbols.js";

const NAME = "yahoo";
const QUOTE_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const SEARCH_BASE = "https://query1.finance.yahoo.com/v1/finance/search";

/** contracts Timeframe → Yahoo interval。 */
const INTERVAL: Record<Timeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "60m",
  "1d": "1d",
};

interface YahooChartResult {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        symbol?: string;
        currency?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
}

interface YahooSearchResult {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    exchange?: string;
    quoteType?: string;
  }>;
}

/**
 * Yahoo Finance（yfinance 相当）アダプタ。キー不要・日米両対応（spec §3.1）。
 * 履歴・JP 価格・全体のフォールバックを担う。レート制御は控えめに自主規制する。
 */
export class YahooAdapter implements ProviderAdapter {
  readonly name = NAME;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;
  private readonly limiter: RateLimiter;

  constructor(deps: AdapterDeps = {}) {
    this.fetchFn = deps.fetchFn ?? defaultFetch;
    this.timeoutMs = deps.timeoutMs ?? 8000;
    // 非公式 API。自主規制として ~1.5 req/s 程度に抑える。
    this.limiter = new RateLimiter({
      intervalMs: 1000,
      maxInInterval: 2,
      ...(deps.now ? { now: deps.now } : {}),
    });
  }

  supports(): boolean {
    return true; // 日米とも対応。チェーンの最終手段になり得る。
  }

  async getQuote(instrumentId: string): Promise<Quote> {
    const parsed = parseInstrumentId(instrumentId);
    const sym = toYahooSymbol(parsed);
    await this.limiter.take();
    const url = `${QUOTE_BASE}/${encodeURIComponent(sym)}?range=1d&interval=1m`;
    const raw = (await getJson(this.fetchFn, url, NAME, {
      timeoutMs: this.timeoutMs,
    })) as YahooChartResult;
    const result = raw.chart?.result?.[0];
    const price = result?.meta?.regularMarketPrice;
    const ts = result?.timestamp?.[result.timestamp.length - 1];
    if (price === undefined || ts === undefined) {
      throw new DomainError(
        "PROVIDER_UNAVAILABLE",
        `${NAME}: missing quote for ${sym}`,
      );
    }
    return {
      instrumentId,
      last: toDecimalString(price),
      ts: epochSecToIso(ts),
      source: NAME,
    };
  }

  async getBars(req: GetBarsRequest): Promise<PriceBar[]> {
    const parsed = parseInstrumentId(req.instrumentId);
    const sym = toYahooSymbol(parsed);
    const period1 = Math.floor(new Date(req.from).getTime() / 1000);
    const period2 = Math.floor(new Date(req.to).getTime() / 1000);
    await this.limiter.take();
    const url =
      `${QUOTE_BASE}/${encodeURIComponent(sym)}` +
      `?period1=${period1}&period2=${period2}&interval=${INTERVAL[req.timeframe]}`;
    const raw = (await getJson(this.fetchFn, url, NAME, {
      timeoutMs: this.timeoutMs,
    })) as YahooChartResult;
    const result = raw.chart?.result?.[0];
    const ts = result?.timestamp;
    const q = result?.indicators?.quote?.[0];
    if (!ts || !q) return [];
    const bars: PriceBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      const v = q.volume?.[i];
      // 欠損バー（休場の穴埋め等）はスキップする。
      if (
        o == null ||
        h == null ||
        l == null ||
        c == null ||
        ts[i] == null
      ) {
        continue;
      }
      bars.push({
        instrumentId: req.instrumentId,
        timeframe: req.timeframe,
        ts: epochSecToIso(ts[i] as number),
        open: toDecimalString(o),
        high: toDecimalString(h),
        low: toDecimalString(l),
        close: toDecimalString(c),
        volume: v == null ? 0 : v,
      });
    }
    return bars;
  }

  async searchInstruments(q: string, market?: Market): Promise<Instrument[]> {
    await this.limiter.take();
    const url = `${SEARCH_BASE}?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
    const raw = (await getJson(this.fetchFn, url, NAME, {
      timeoutMs: this.timeoutMs,
    })) as YahooSearchResult;
    const out: Instrument[] = [];
    for (const item of raw.quotes ?? []) {
      const sym = item.symbol;
      if (!sym) continue;
      const type = item.quoteType;
      if (type !== "EQUITY" && type !== "ETF") continue;
      const isJp = sym.endsWith(".T");
      const instMarket: Market = isJp ? "JP" : "US";
      if (market && market !== instMarket) continue;
      const fallbackExchange = isJp ? "TSE" : "NASDAQ";
      const id = fromYahooSymbol(sym, fallbackExchange);
      const parsed = parseInstrumentId(id);
      out.push(this.toInstrument(parsed, item.longname ?? item.shortname ?? sym, type));
    }
    return out;
  }

  private toInstrument(
    parsed: ParsedInstrumentId,
    name: string,
    quoteType: string,
  ): Instrument {
    return {
      id: buildInstrumentId(parsed.exchange, parsed.symbol),
      symbol: parsed.symbol,
      exchange: parsed.exchange,
      market: parsed.market,
      name,
      currency: parsed.currency,
      type: quoteType === "ETF" ? "ETF" : "STOCK",
      lotSize: parsed.market === "JP" ? 100 : 1,
      tickRules: [],
      isActive: true,
    };
  }
}
