import type {
  CorporateAction,
  GetBarsRequest,
  GetCorporateActionsRequest,
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
import {
  resolveMarginEligibility,
  type MarginEligibilityOptions,
} from "../margin-eligibility.js";
import { toDecimalString, divideToDecimalString, epochSecToIso } from "../decimal-util.js";
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

interface YahooDividendEvent {
  amount?: number;
  date?: number; // epoch 秒（ex-date）
}

interface YahooSplitEvent {
  numerator?: number;
  denominator?: number;
  splitRatio?: string; // "4:1" 等
  date?: number; // epoch 秒（ex-date）
}

interface YahooChartResult {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        symbol?: string;
        currency?: string;
      };
      timestamp?: number[];
      events?: {
        dividends?: Record<string, YahooDividendEvent>;
        splits?: Record<string, YahooSplitEvent>;
      };
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
  private readonly marginEligibility: MarginEligibilityOptions;

  constructor(deps: AdapterDeps = {}) {
    this.fetchFn = deps.fetchFn ?? defaultFetch;
    this.timeoutMs = deps.timeoutMs ?? 8000;
    this.marginEligibility = deps.marginEligibility ?? {};
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

  /**
   * 配当/分割（コーポレートアクション）を取得する（spec §2.1 P1）。
   *
   * Yahoo chart の `events=div|split` は ex-date（epoch 秒）→ イベントの map を返す。
   * - 配当: `amount` を DecimalString の配当額として正規化。
   * - 分割: `numerator/denominator`（無ければ `splitRatio` "n:m"）から比率を算出。
   * 1d interval（最小限のデータ）で期間分のイベントだけ取得する。期間外は呼び出し側で
   * レジストリが再フィルタするが、ここでも from/to で素朴に絞り無駄を省く。
   */
  async getCorporateActions(
    req: GetCorporateActionsRequest,
  ): Promise<CorporateAction[]> {
    const parsed = parseInstrumentId(req.instrumentId);
    const sym = toYahooSymbol(parsed);
    const period1 = Math.floor(new Date(req.from).getTime() / 1000);
    const period2 = Math.floor(new Date(req.to).getTime() / 1000);
    await this.limiter.take();
    const url =
      `${QUOTE_BASE}/${encodeURIComponent(sym)}` +
      `?period1=${period1}&period2=${period2}&interval=1d&events=div%7Csplit`;
    const raw = (await getJson(this.fetchFn, url, NAME, {
      timeoutMs: this.timeoutMs,
    })) as YahooChartResult;
    const events = raw.chart?.result?.[0]?.events;
    if (!events) return [];

    const out: CorporateAction[] = [];
    for (const div of Object.values(events.dividends ?? {})) {
      if (div.amount == null || div.date == null) continue;
      out.push({
        instrumentId: req.instrumentId,
        type: "DIVIDEND",
        exDate: epochSecToIso(div.date),
        value: toDecimalString(div.amount),
      });
    }
    for (const sp of Object.values(events.splits ?? {})) {
      if (sp.date == null) continue;
      const ratio = YahooAdapter.splitRatio(sp);
      if (ratio === null) continue;
      out.push({
        instrumentId: req.instrumentId,
        type: "SPLIT",
        exDate: epochSecToIso(sp.date),
        value: ratio,
      });
    }
    // ex-date 昇順で安定化（map の列挙順に依存しない）。
    out.sort((a, b) => a.exDate.localeCompare(b.exDate));
    return out;
  }

  /**
   * 分割比率を DecimalString に正規化する（new shares / old shares）。
   * 例 4:1 フォワード分割 → "4"、1:10 併合 → "0.1"。算出不能なら null。
   */
  private static splitRatio(sp: YahooSplitEvent): string | null {
    if (sp.numerator != null && sp.denominator != null && sp.denominator !== 0) {
      return divideToDecimalString(sp.numerator, sp.denominator);
    }
    if (sp.splitRatio) {
      const [num, den] = sp.splitRatio.split(":").map((s) => Number(s.trim()));
      if (
        num != null &&
        den != null &&
        Number.isFinite(num) &&
        Number.isFinite(den) &&
        den !== 0
      ) {
        return divideToDecimalString(num, den);
      }
    }
    return null;
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
    const id = buildInstrumentId(parsed.exchange, parsed.symbol);
    const type = quoteType === "ETF" ? "ETF" : "STOCK";
    return {
      id,
      symbol: parsed.symbol,
      exchange: parsed.exchange,
      market: parsed.market,
      name,
      currency: parsed.currency,
      type,
      lotSize: parsed.market === "JP" ? 100 : 1,
      tickRules: [],
      isActive: true,
      // 貸借区分上の信用建て可否（ルール既定＋override）。不明な側は省略（undefined）。
      ...resolveMarginEligibility(
        { id, market: parsed.market, type },
        this.marginEligibility,
      ),
    };
  }
}
