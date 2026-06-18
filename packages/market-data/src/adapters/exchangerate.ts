import type { FxRate } from "@stonks/contracts";
import { DomainError } from "@stonks/contracts";
import type { AdapterDeps, FxAdapter } from "../types.js";
import { defaultFetch, getJson, type FetchFn } from "../http.js";
import { RateLimiter } from "../rate-limiter.js";
import { TtlCache } from "../cache.js";
import { toDecimalString } from "../decimal-util.js";

const NAME = "exchangerate.host";

interface ExchangeRateResponse {
  success?: boolean;
  rates?: Record<string, number>;
  result?: number;
  // historical エンドポイントは date を返す。
  date?: string;
}

export interface ExchangeRateConfig extends AdapterDeps {
  /** 既定 https://api.exchangerate.host（FX_API_BASE で上書き可）。 */
  baseUrl?: string;
  /** 為替の TTL（ms）。換算は秒単位の鮮度を要さないため既定 10 分。 */
  cacheTtlMs?: number;
}

/**
 * 為替アダプタ（spec §3.1: USD/JPY・無料）。FxProvider 実装の中身。
 * 最新値はキャッシュし、無料枠の呼び出しを節約する。
 */
export class ExchangeRateAdapter implements FxAdapter {
  readonly name = NAME;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;
  private readonly limiter: RateLimiter;
  private readonly cache: TtlCache<FxRate>;
  private readonly now: () => number;

  constructor(config: ExchangeRateConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "https://api.exchangerate.host").replace(
      /\/$/,
      "",
    );
    this.fetchFn = config.fetchFn ?? defaultFetch;
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.now = config.now ?? Date.now;
    this.limiter = new RateLimiter({
      intervalMs: 1000,
      maxInInterval: 2,
      ...(config.now ? { now: config.now } : {}),
    });
    this.cache = new TtlCache<FxRate>(config.cacheTtlMs ?? 10 * 60 * 1000, this.now);
  }

  static fromEnv(
    env: Record<string, string | undefined> = process.env,
    deps: AdapterDeps = {},
  ): ExchangeRateAdapter {
    const baseUrl = env.FX_API_BASE;
    return new ExchangeRateAdapter({ ...(baseUrl ? { baseUrl } : {}), ...deps });
  }

  async getRate(base: "USD", quote: "JPY", at?: Date): Promise<FxRate> {
    if (base !== "USD" || quote !== "JPY") {
      throw new DomainError(
        "VALIDATION",
        `${NAME}: only USD/JPY is supported`,
      );
    }
    const dateStr = at ? at.toISOString().slice(0, 10) : "latest";
    return this.cache.wrap(dateStr, async () => {
      await this.limiter.take();
      const path = at ? `/${dateStr}` : "/latest";
      const url = `${this.baseUrl}${path}?base=USD&symbols=JPY`;
      const raw = (await getJson(this.fetchFn, url, NAME, {
        timeoutMs: this.timeoutMs,
      })) as ExchangeRateResponse;
      const rate = raw.rates?.JPY;
      if (rate === undefined) {
        throw new DomainError(
          "PROVIDER_UNAVAILABLE",
          `${NAME}: missing USD/JPY rate`,
        );
      }
      const ts = raw.date
        ? new Date(`${raw.date}T00:00:00.000Z`).toISOString()
        : new Date(this.now()).toISOString();
      return {
        base: "USD",
        quote: "JPY",
        rate: toDecimalString(rate),
        ts,
      };
    });
  }
}
