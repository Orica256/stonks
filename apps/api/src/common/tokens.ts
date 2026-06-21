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

  /** analytics の IndicatorService。 */
  IndicatorService: "INDICATOR_SERVICE",

  /** backtest の BacktestRunnerFactory（universe/range ごとにデータソースを束ねて実行）。 */
  BacktestRunnerFactory: "BACKTEST_RUNNER_FACTORY",

  /** agent-trader の AgentTradingService / PerformanceEvaluator と内部 IF。 */
  AgentTradingService: "AGENT_TRADING_SERVICE",
  PerformanceEvaluator: "PERFORMANCE_EVALUATOR",
  AgentProfileStore: "AGENT_PROFILE_STORE",
  AgentDecisionRepository: "AGENT_DECISION_REPOSITORY",
  PerformanceSnapshotRepository: "PERFORMANCE_SNAPSHOT_REPOSITORY",

  /** アプリ設定。 */
  AppConfig: "APP_CONFIG",
} as const;
