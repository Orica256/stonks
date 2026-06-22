import type {
  CorporateAction,
  FxRate,
  GetBarsRequest,
  GetCorporateActionsRequest,
  Instrument,
  Market,
  PriceBar,
  Quote,
} from "@stonks/contracts";
import type { FetchFn } from "./http.js";

/**
 * 単一プロバイダの能力を表す内部アダプタ契約。
 * MarketDataProvider 公開 IF とは別物で、レジストリがこれらを
 * フォールバックチェーンに束ねて公開契約へ昇格させる。
 *
 * 各メソッドは「未対応」を表現するため任意（undefined 可）。
 * 失敗時は DomainError を投げ、レジストリが次アダプタへフォールバックする。
 */
export interface ProviderAdapter {
  /** ログ・Quote.source に使う識別名。 */
  readonly name: string;

  /** この銘柄を扱えるか（市場・取引所での足切り）。 */
  supports(instrumentId: string): boolean;

  searchInstruments?(q: string, market?: Market): Promise<Instrument[]>;
  getQuote?(instrumentId: string): Promise<Quote>;
  getBars?(req: GetBarsRequest): Promise<PriceBar[]>;

  /**
   * 配当/分割（コーポレートアクション）を取得する（spec §2.1 P1, §6.1）。
   * `exDate` が `req.from`〜`req.to`（UTC）に入るものを返す。未対応アダプタは
   * このメソッドを持たず、レジストリの候補から自動で外れる（getBars 等と同パターン）。
   */
  getCorporateActions?(
    req: GetCorporateActionsRequest,
  ): Promise<CorporateAction[]>;
}

/** 為替専用アダプタ（USD/JPY）。 */
export interface FxAdapter {
  readonly name: string;
  getRate(base: "USD", quote: "JPY", at?: Date): Promise<FxRate>;
}

/** アダプタ共通の構築オプション（fetch/時刻の DI 点）。 */
export interface AdapterDeps {
  fetchFn?: FetchFn;
  now?: () => number;
  /** 単一リクエストのタイムアウト（ms）。 */
  timeoutMs?: number;
}
