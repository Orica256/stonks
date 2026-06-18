import type {
  GetBarsRequest,
  PriceBar,
  Quote,
} from "@stonks/contracts";
import { DomainError } from "@stonks/contracts";
import type { AdapterDeps, ProviderAdapter } from "../types.js";
import { defaultFetch, getJson, type FetchFn } from "../http.js";
import { RateLimiter } from "../rate-limiter.js";
import { toDecimalString } from "../decimal-util.js";
import { parseInstrumentId, toJQuantsCode } from "../symbols.js";

const NAME = "jquants";
const BASE = "https://api.jquants.com/v1";

interface JQuantsDailyQuote {
  Date?: string; // "YYYY-MM-DD"
  Code?: string;
  Open?: number | null;
  High?: number | null;
  Low?: number | null;
  Close?: number | null;
  Volume?: number | null;
}

interface JQuantsDailyResponse {
  daily_quotes?: JQuantsDailyQuote[];
}

interface JQuantsTokenResponse {
  idToken?: string;
}

export interface JQuantsConfig extends AdapterDeps {
  refreshToken: string;
  /** idToken のキャッシュ寿命（ms）。J-Quants の idToken は約 24h 有効。 */
  idTokenTtlMs?: number;
}

/**
 * J-Quants アダプタ（spec §3.1: JP 権威データ・無料枠・EOD 中心）。
 * 無料枠は日足のみ・配信遅延あり。refreshToken から idToken を取得して使う。
 * 日本市場（TSE）専用。日中足や US は扱わない（supports で false）。
 */
export class JQuantsAdapter implements ProviderAdapter {
  readonly name = NAME;
  private readonly refreshToken: string;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;
  private readonly limiter: RateLimiter;
  private readonly idTokenTtlMs: number;
  private readonly now: () => number;
  private idToken: string | undefined;
  private idTokenExpiresAt = 0;

  constructor(config: JQuantsConfig) {
    this.refreshToken = config.refreshToken;
    this.fetchFn = config.fetchFn ?? defaultFetch;
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.idTokenTtlMs = config.idTokenTtlMs ?? 12 * 60 * 60 * 1000;
    this.now = config.now ?? Date.now;
    this.limiter = new RateLimiter({
      intervalMs: 1000,
      maxInInterval: 2,
      ...(config.now ? { now: config.now } : {}),
    });
  }

  /** 環境変数からの生成。refreshToken 未設定なら null（スキップ）。 */
  static fromEnv(
    env: Record<string, string | undefined> = process.env,
    deps: AdapterDeps = {},
  ): JQuantsAdapter | null {
    const refreshToken = env.JQUANTS_REFRESH_TOKEN;
    if (!refreshToken) return null;
    return new JQuantsAdapter({ refreshToken, ...deps });
  }

  supports(instrumentId: string): boolean {
    return parseInstrumentId(instrumentId).market === "JP";
  }

  private async ensureIdToken(): Promise<string> {
    if (this.idToken && this.now() < this.idTokenExpiresAt) {
      return this.idToken;
    }
    await this.limiter.take();
    const raw = (await getJson(
      this.fetchFn,
      `${BASE}/token/auth_refresh?refreshtoken=${encodeURIComponent(this.refreshToken)}`,
      NAME,
      { timeoutMs: this.timeoutMs },
    )) as JQuantsTokenResponse;
    if (!raw.idToken) {
      throw new DomainError("PROVIDER_UNAVAILABLE", `${NAME}: token refresh failed`);
    }
    this.idToken = raw.idToken;
    this.idTokenExpiresAt = this.now() + this.idTokenTtlMs;
    return raw.idToken;
  }

  private async fetchDaily(
    code: string,
    from?: string,
    to?: string,
  ): Promise<JQuantsDailyQuote[]> {
    const token = await this.ensureIdToken();
    let url = `${BASE}/prices/daily_quotes?code=${encodeURIComponent(code)}`;
    if (from) url += `&from=${from}`;
    if (to) url += `&to=${to}`;
    await this.limiter.take();
    const raw = (await getJson(this.fetchFn, url, NAME, {
      timeoutMs: this.timeoutMs,
      headers: { Authorization: `Bearer ${token}` },
    })) as JQuantsDailyResponse;
    return raw.daily_quotes ?? [];
  }

  /** "YYYY-MM-DD"（JST 市場日）→ ISO8601(UTC)。EOD は当日 00:00Z に正規化。 */
  private static dateToIso(date: string): string {
    return new Date(`${date}T00:00:00.000Z`).toISOString();
  }

  async getQuote(instrumentId: string): Promise<Quote> {
    const parsed = parseInstrumentId(instrumentId);
    const code = toJQuantsCode(parsed);
    const rows = await this.fetchDaily(code);
    const last = rows.filter((r) => r.Close != null).at(-1);
    if (!last || last.Close == null || !last.Date) {
      throw new DomainError(
        "PROVIDER_UNAVAILABLE",
        `${NAME}: no daily close for ${code}`,
      );
    }
    return {
      instrumentId,
      last: toDecimalString(last.Close),
      ts: JQuantsAdapter.dateToIso(last.Date),
      source: NAME,
    };
  }

  async getBars(req: GetBarsRequest): Promise<PriceBar[]> {
    // 無料枠は日足のみ。1d 以外はこのアダプタでは未対応。
    if (req.timeframe !== "1d") {
      throw new DomainError(
        "VALIDATION",
        `${NAME}: only 1d timeframe is supported on the free tier`,
      );
    }
    const parsed = parseInstrumentId(req.instrumentId);
    const code = toJQuantsCode(parsed);
    const from = new Date(req.from).toISOString().slice(0, 10);
    const to = new Date(req.to).toISOString().slice(0, 10);
    const rows = await this.fetchDaily(code, from, to);
    const bars: PriceBar[] = [];
    for (const r of rows) {
      if (
        r.Date == null ||
        r.Open == null ||
        r.High == null ||
        r.Low == null ||
        r.Close == null
      ) {
        continue;
      }
      bars.push({
        instrumentId: req.instrumentId,
        timeframe: "1d",
        ts: JQuantsAdapter.dateToIso(r.Date),
        open: toDecimalString(r.Open),
        high: toDecimalString(r.High),
        low: toDecimalString(r.Low),
        close: toDecimalString(r.Close),
        volume: r.Volume ?? 0,
      });
    }
    return bars;
  }
}
