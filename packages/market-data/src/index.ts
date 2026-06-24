/**
 * @stonks/market-data — 株価・銘柄プロバイダ抽象とアダプタ群（spec §3.1, §6.1）。
 *
 * 外部 API（Finnhub / Yahoo Finance / J-Quants / exchangerate.host）の差異を
 * このパッケージ内のアダプタ層に閉じ込め、フォールバックチェーン・レート制御・
 * キャッシュ・正規化を経て contracts の MarketDataProvider / PriceProvider /
 * FxProvider を満たす。他モジュールはこれらの IF 経由でのみ価格を得る。
 */

// 公開のファサード
export { createMarketDataProvider } from "./factory.js";
export type { FactoryOptions } from "./factory.js";
export { MarketDataRegistry } from "./registry.js";
export type { RegistryOptions } from "./registry.js";

// アダプタ（個別構成・テスト・ingestion-worker からの利用向け）
export { FinnhubAdapter } from "./adapters/finnhub.js";
export type { FinnhubConfig } from "./adapters/finnhub.js";
export { YahooAdapter } from "./adapters/yahoo.js";
export { JQuantsAdapter } from "./adapters/jquants.js";
export type { JQuantsConfig } from "./adapters/jquants.js";
export { ExchangeRateAdapter } from "./adapters/exchangerate.js";
export type { ExchangeRateConfig } from "./adapters/exchangerate.js";

// インフラ部品
export { RateLimiter } from "./rate-limiter.js";
export type { RateLimiterOptions } from "./rate-limiter.js";
export { TtlCache } from "./cache.js";
export { defaultFetch, getJson } from "./http.js";
export type { FetchFn, HttpOptions } from "./http.js";

// 内部契約・正規化ヘルパ
export type { ProviderAdapter, FxAdapter, AdapterDeps } from "./types.js";
export {
  buildInstrumentId,
  parseInstrumentId,
  toYahooSymbol,
  fromYahooSymbol,
  toFinnhubSymbol,
  toJQuantsCode,
} from "./symbols.js";
export type { ParsedInstrumentId } from "./symbols.js";
export {
  resolveMarginEligibility,
  parseMarginEligibilityEnv,
} from "./margin-eligibility.js";
export type {
  MarginEligibility,
  MarginEligibilityOverride,
  MarginEligibilityOptions,
} from "./margin-eligibility.js";
