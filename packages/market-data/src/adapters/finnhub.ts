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
  parseInstrumentId,
  toFinnhubSymbol,
} from "../symbols.js";

const NAME = "finnhub";
const BASE = "https://finnhub.io/api/v1";

/** contracts Timeframe → Finnhub resolution。 */
const RESOLUTION: Record<Timeframe, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "1d": "D",
};

interface FinnhubQuote {
  c?: number; // current
  t?: number; // unix sec
}

interface FinnhubCandles {
  s?: string; // "ok" | "no_data"
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
}

interface FinnhubSearch {
  result?: Array<{
    symbol?: string;
    description?: string;
    type?: string;
  }>;
}

export interface FinnhubConfig extends AdapterDeps {
  apiKey: string;
}

/**
 * Finnhub アダプタ（spec §3.1: US 中心・無料枠 60 req/min・準リアルタイム）。
 * API キー（FINNHUB_API_KEY）必須。未設定なら fromEnv() は null を返しスキップされる。
 */
export class FinnhubAdapter implements ProviderAdapter {
  readonly name = NAME;
  private readonly apiKey: string;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;
  private readonly limiter: RateLimiter;

  constructor(config: FinnhubConfig) {
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetchFn ?? defaultFetch;
    this.timeoutMs = config.timeoutMs ?? 8000;
    // 無料枠 60 req/min を尊重。安全側に倍の窓を確保。
    this.limiter = new RateLimiter({
      intervalMs: 60_000,
      maxInInterval: 60,
      ...(config.now ? { now: config.now } : {}),
    });
  }

  /** 環境変数からの生成。キー未設定なら null（レジストリがスキップ）。 */
  static fromEnv(
    env: Record<string, string | undefined> = process.env,
    deps: AdapterDeps = {},
  ): FinnhubAdapter | null {
    const apiKey = env.FINNHUB_API_KEY;
    if (!apiKey) return null;
    return new FinnhubAdapter({ apiKey, ...deps });
  }

  supports(instrumentId: string): boolean {
    // 無料枠は US が実用的。JP は遅延/非対応のことが多く Yahoo/J-Quants に委ねる。
    return parseInstrumentId(instrumentId).market === "US";
  }

  private withKey(url: string): string {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}token=${encodeURIComponent(this.apiKey)}`;
  }

  async getQuote(instrumentId: string): Promise<Quote> {
    const parsed = parseInstrumentId(instrumentId);
    const sym = toFinnhubSymbol(parsed);
    await this.limiter.take();
    const raw = (await getJson(
      this.fetchFn,
      this.withKey(`${BASE}/quote?symbol=${encodeURIComponent(sym)}`),
      NAME,
      { timeoutMs: this.timeoutMs },
    )) as FinnhubQuote;
    if (raw.c === undefined || raw.c === 0 || raw.t === undefined) {
      throw new DomainError(
        "PROVIDER_UNAVAILABLE",
        `${NAME}: missing quote for ${sym}`,
      );
    }
    return {
      instrumentId,
      last: toDecimalString(raw.c),
      ts: epochSecToIso(raw.t),
      source: NAME,
    };
  }

  async getBars(req: GetBarsRequest): Promise<PriceBar[]> {
    const parsed = parseInstrumentId(req.instrumentId);
    const sym = toFinnhubSymbol(parsed);
    const from = Math.floor(new Date(req.from).getTime() / 1000);
    const to = Math.floor(new Date(req.to).getTime() / 1000);
    await this.limiter.take();
    const raw = (await getJson(
      this.fetchFn,
      this.withKey(
        `${BASE}/stock/candle?symbol=${encodeURIComponent(sym)}` +
          `&resolution=${RESOLUTION[req.timeframe]}&from=${from}&to=${to}`,
      ),
      NAME,
      { timeoutMs: this.timeoutMs },
    )) as FinnhubCandles;
    if (raw.s !== "ok" || !raw.t) return [];
    const bars: PriceBar[] = [];
    for (let i = 0; i < raw.t.length; i++) {
      const t = raw.t[i];
      const o = raw.o?.[i];
      const h = raw.h?.[i];
      const l = raw.l?.[i];
      const c = raw.c?.[i];
      if (t == null || o == null || h == null || l == null || c == null) {
        continue;
      }
      bars.push({
        instrumentId: req.instrumentId,
        timeframe: req.timeframe,
        ts: epochSecToIso(t),
        open: toDecimalString(o),
        high: toDecimalString(h),
        low: toDecimalString(l),
        close: toDecimalString(c),
        volume: raw.v?.[i] ?? 0,
      });
    }
    return bars;
  }

  async searchInstruments(q: string, market?: Market): Promise<Instrument[]> {
    if (market === "JP") return []; // 無料枠の実用対象外
    await this.limiter.take();
    const raw = (await getJson(
      this.fetchFn,
      this.withKey(`${BASE}/search?q=${encodeURIComponent(q)}`),
      NAME,
      { timeoutMs: this.timeoutMs },
    )) as FinnhubSearch;
    const out: Instrument[] = [];
    for (const item of raw.result ?? []) {
      const sym = item.symbol;
      // 取引所サフィックス付き（外国市場）は無料枠の対象外として除外。
      if (!sym || sym.includes(".")) continue;
      const exchange = "NASDAQ" as const; // Finnhub 検索は取引所を返さないため既定。
      out.push({
        id: buildInstrumentId(exchange, sym),
        symbol: sym.toUpperCase(),
        exchange,
        market: "US",
        name: item.description ?? sym,
        currency: "USD",
        type: item.type === "ETF" ? "ETF" : "STOCK",
        lotSize: 1,
        tickRules: [],
        isActive: true,
      });
    }
    return out;
  }
}
