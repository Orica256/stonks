/**
 * DI トークン（contracts のインターフェースは型情報のみで実行時トークンにできないため、
 * Nest の provide/inject 用に文字列トークンを定義する）。
 */
export const TOKENS = {
  /** @stonks/market-data の MarketDataRegistry（MarketDataProvider/PriceProvider/FxProvider 一体）。 */
  MarketData: "MARKET_DATA_PROVIDER",
  PriceProvider: "PRICE_PROVIDER",
  FxProvider: "FX_PROVIDER",

  /** trading-engine の TradingEngine 実装。 */
  TradingEngine: "TRADING_ENGINE",
  OrderRepository: "ORDER_REPOSITORY",
  AccountStateProvider: "ACCOUNT_STATE_PROVIDER",
  InstrumentProvider: "INSTRUMENT_PROVIDER",

  /** portfolio の PortfolioService 実装と内部リポジトリ。 */
  PortfolioService: "PORTFOLIO_SERVICE",
  PortfolioRepository: "PORTFOLIO_REPOSITORY",

  /** 取引履歴の記録/参照（結線層のギャップ吸収）。 */
  TradeLog: "TRADE_LOG",

  /** analytics の IndicatorService。 */
  IndicatorService: "INDICATOR_SERVICE",

  /** アプリ設定。 */
  AppConfig: "APP_CONFIG",
} as const;
