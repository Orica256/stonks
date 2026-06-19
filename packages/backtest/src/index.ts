/**
 * @stonks/backtest — ヒストリカル OHLCV に対する戦略バックテスト（spec §2.5, §6.5）。
 *
 * 公開契約 `BacktestRunner` / `StrategyDef` / `BacktestResult` は @stonks/contracts に準拠する。
 * 約定は trading-engine（StandardTradingEngine / Fee / Fill）を、指標計算は analytics を再利用し、
 * 重複実装しない（CLAUDE.md §0・spec §4.3）。仮想時間で過去バーを順次供給し、その時点までの
 * データのみで判断する（ルックアヘッド禁止）。金額は core-domain の Money/Decimal 経由。
 */
export { HistoricalBacktestRunner } from "./runner.js";
export { HistoricalPriceFeed } from "./price-feed.js";
export { InMemoryDataSource } from "./in-memory.js";
export { compileWhen, type WhenEvaluator } from "./rule-evaluator.js";
export { computeMetrics, type EquitySample } from "./metrics.js";
export type { BacktestDataSource } from "./ports.js";
