import type {
  CorporateAction,
  FxProvider,
  FxRate,
  GetBarsRequest,
  GetCorporateActionsRequest,
  Instrument,
  Market,
  MarketDataProvider,
  Money,
  PriceBar,
  PriceProvider,
  Quote,
} from "@stonks/contracts";
import { DomainError } from "@stonks/contracts";
import type { FxAdapter, ProviderAdapter } from "./types.js";
import { TtlCache } from "./cache.js";
import { parseInstrumentId } from "./symbols.js";

export interface RegistryOptions {
  /** 優先順のアダプタ列。先頭から順に試し、失敗で次へフォールバックする。 */
  adapters: ProviderAdapter[];
  /** 為替アダプタ（FxProvider 実装の中身）。 */
  fxAdapter?: FxAdapter;
  /** Quote キャッシュ TTL（ms）。0 で無効。既定 5 秒（準リアルタイム）。 */
  quoteCacheTtlMs?: number;
  now?: () => number;
}

/**
 * 複数アダプタを束ねるフォールバックチェーン（spec §3.1）。
 * MarketDataProvider / PriceProvider / FxProvider の 3 契約を一体で満たす。
 *
 * - 各操作は `supports()` を満たすアダプタを優先順に試行。
 * - あるアダプタが投げたら次へフォールバックし、全滅で最後のエラーを再送出。
 * - Quote は短 TTL でキャッシュし、無料枠の呼び出しを節約する。
 */
export class MarketDataRegistry
  implements MarketDataProvider, PriceProvider, FxProvider
{
  private readonly adapters: ProviderAdapter[];
  private readonly fxAdapter: FxAdapter | undefined;
  private readonly quoteCache: TtlCache<Quote> | undefined;

  constructor(opts: RegistryOptions) {
    this.adapters = opts.adapters;
    this.fxAdapter = opts.fxAdapter;
    const ttl = opts.quoteCacheTtlMs ?? 5000;
    this.quoteCache =
      ttl > 0 ? new TtlCache<Quote>(ttl, opts.now ?? Date.now) : undefined;
  }

  /** 指定操作に対応する候補アダプタを優先順に列挙する。 */
  private candidates(
    method: keyof ProviderAdapter,
    instrumentId?: string,
  ): ProviderAdapter[] {
    return this.adapters.filter((a) => {
      if (typeof a[method] !== "function") return false;
      if (instrumentId && !a.supports(instrumentId)) return false;
      return true;
    });
  }

  /** 候補を順に試し、最初の成功を返す。全滅なら最後のエラーを投げる。 */
  private async fallback<T>(
    candidates: ProviderAdapter[],
    op: (a: ProviderAdapter) => Promise<T>,
    label: string,
  ): Promise<T> {
    if (candidates.length === 0) {
      throw new DomainError(
        "PROVIDER_UNAVAILABLE",
        `no adapter available for ${label}`,
      );
    }
    let lastErr: unknown;
    for (const a of candidates) {
      try {
        return await op(a);
      } catch (e) {
        lastErr = e;
        // 次のアダプタへフォールバック（縮退）。
      }
    }
    if (lastErr instanceof DomainError) throw lastErr;
    throw new DomainError(
      "PROVIDER_UNAVAILABLE",
      `all adapters failed for ${label}`,
      lastErr,
    );
  }

  async searchInstruments(q: string, market?: Market): Promise<Instrument[]> {
    // 検索は instrumentId を取らないため supports() による足切りは行わず、
    // searchInstruments を実装する全アダプタを優先順に試す。
    return this.fallback(
      this.candidates("searchInstruments"),
      (a) => a.searchInstruments!(q, market),
      "searchInstruments",
    );
  }

  async getQuote(instrumentId: string): Promise<Quote> {
    const loader = (): Promise<Quote> =>
      this.fallback(
        this.candidates("getQuote", instrumentId),
        (a) => a.getQuote!(instrumentId),
        `getQuote(${instrumentId})`,
      );
    if (!this.quoteCache) return loader();
    return this.quoteCache.wrap(instrumentId, loader);
  }

  async getBars(req: GetBarsRequest): Promise<PriceBar[]> {
    return this.fallback(
      this.candidates("getBars", req.instrumentId),
      (a) => a.getBars!(req),
      `getBars(${req.instrumentId})`,
    );
  }

  /**
   * 配当/分割（コーポレートアクション）を取得する（spec §2.1 P1, §6.1）。
   *
   * getBars と同じフォールバックチェーン＋候補フィルタに乗せる。
   * getCorporateActions を実装するアダプタ（J-Quants 優先・Yahoo フォールバック）
   * のみが候補となり、対応アダプタが無ければ PROVIDER_UNAVAILABLE を投げる。
   * 念のため `exDate` を `req.from`〜`req.to`（UTC）で再フィルタしてから返す。
   */
  async getCorporateActions(
    req: GetCorporateActionsRequest,
  ): Promise<CorporateAction[]> {
    const actions = await this.fallback(
      this.candidates("getCorporateActions", req.instrumentId),
      (a) => a.getCorporateActions!(req),
      `getCorporateActions(${req.instrumentId})`,
    );
    const fromMs = new Date(req.from).getTime();
    const toMs = new Date(req.to).getTime();
    return actions.filter((ca) => {
      const ex = new Date(ca.exDate).getTime();
      return ex >= fromMs && ex <= toMs;
    });
  }

  /**
   * PriceProvider: 最新（または at 時点）の価格を Money で返す。
   * at 省略時は getQuote、at 指定時はその日の日足 close を採用する。
   */
  async getLatestPrice(instrumentId: string, at?: Date): Promise<Money> {
    const { currency } = parseInstrumentId(instrumentId);
    if (!at) {
      const quote = await this.getQuote(instrumentId);
      return { amount: quote.last, currency };
    }
    // at 時点: その日を含む 1d バーを取得し close を価格とする。
    const from = new Date(at.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to = at.toISOString();
    const bars = await this.getBars({
      instrumentId,
      timeframe: "1d",
      from,
      to,
    });
    const last = bars.at(-1);
    if (!last) {
      throw new DomainError(
        "NOT_FOUND",
        `no price for ${instrumentId} at ${to}`,
      );
    }
    return { amount: last.close, currency };
  }

  /** FxProvider: USD/JPY レート。為替アダプタ未設定なら PROVIDER_UNAVAILABLE。 */
  async getRate(base: "USD", quote: "JPY", at?: Date): Promise<FxRate> {
    if (!this.fxAdapter) {
      throw new DomainError("PROVIDER_UNAVAILABLE", "no FX adapter configured");
    }
    return this.fxAdapter.getRate(base, quote, at);
  }
}
