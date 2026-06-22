/**
 * @stonks/agent-trader — AI エージェント取引・成績評価（spec §2.7 / §6.6 / §5.2）。
 *
 * 公開契約は @stonks/contracts の AgentTradingService / RiskGuard / PerformanceEvaluator に
 * 厳密準拠。発注は TradingEngine IF、状態は PortfolioService IF、価格は PriceProvider IF
 * 経由でのみ行い、それらドメインパッケージを直接 import しない（CLAUDE.md §0 / §4.3 / §8）。
 *
 * 監査証跡（AgentDecision）・成績スナップショットの永続化は内部の最小リポジトリ IF に対して行い、
 * @stonks/db を直接 import しない。Phase 1 は in-memory 実装、実 DB 結線は api 側 Phase 2。
 */
export { DefaultAgentTradingService } from "./agent-trading-service.js";
export type {
  AgentProfileProvider,
  AgentTradingServiceDeps,
  IdFactory,
  RiskGuardFactory,
} from "./agent-trading-service.js";

export { DefaultRiskGuard } from "./risk-guard.js";
export type { RiskGuardDeps, RiskState } from "./risk-guard.js";

export {
  DefaultPerformanceEvaluator,
  BenchmarkUnavailableError,
} from "./performance-evaluator.js";
export type {
  BenchmarkConfig,
  PerformanceEvaluatorDeps,
} from "./performance-evaluator.js";

export {
  InMemoryAgentDecisionRepository,
  InMemoryPerformanceSnapshotRepository,
} from "./in-memory-repository.js";
export type {
  AgentDecisionRepository,
  PerformanceSnapshotRepository,
} from "./repository.js";

export {
  FakeAgentProfileProvider,
  FakePortfolioService,
  FakePriceProvider,
  FakeTradingEngine,
} from "./fakes.js";
export type { FakePortfolioState } from "./fakes.js";
