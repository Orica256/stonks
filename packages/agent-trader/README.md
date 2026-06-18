# @stonks/agent-trader

AI エージェント取引・成績評価（spec §2.7 / §6.6 / §5.2 / §9）。

Claude/LLM の「意思決定」を受け取り、**監査記録 → リスク検証 → 発注委譲 → 成績評価**を担う層。
LLM 呼び出しそのもの・自律ループ実行は持たない（agent-runner の責務）。実マネー・実発注には接続しない（CLAUDE.md §8）。

## 責務
- `DefaultAgentTradingService`
  - `submitDecision(...)` — **rationale 付き AgentDecision を必ず先に記録**し、`AgentProfile.enabled` /
    `riskLimits` を `RiskGuard` で各アクションごとに検証。通過した ORDER/CANCEL のみ `TradingEngine` IF へ
    委譲し、生成 Order を `decision.resultOrderIds` にひも付けて返す。**監査証跡の無い発注を作らない**（spec §5.2）。
    空 rationale・未知 profile は拒否。`enabled=false` は発注せず decision のみ記録。
  - `buildObservation(accountId)` — `PortfolioService` の保有・サマリと時価から `AgentObservation` を組み立てる。
- `DefaultRiskGuard` — 暴走防止（spec §9）。`maxOrderNotional` / `maxDailyNotional`（当日累計＋本注文）/
  `maxPositionPct`（約定後集中度）/ 買い注文の現金不足を判定。CANCEL/HOLD は常に許可。
  上限未設定の項目は無効化。
- `DefaultPerformanceEvaluator`
  - `snapshot(accountId, at)` — `at` 以前のエクイティ点のみで 累積リターン・最大DD・年率シャープ・勝率を計算
    （**ルックアヘッド禁止**）。任意で `PerformanceSnapshotRepository` に永続化。
  - `compare(accountId, benchmark, range)` — 戦略リターン（手数料込みエクイティ由来）と
    ベンチ（BUY_AND_HOLD/指数）の同条件リターンを比較し超過リターンを返す。

## 公平性・不変条件
- 監査証跡の欠落を許さない: 全発注は rationale 付き `AgentDecision` にひも付く（spec §5.2）。
- RiskGuard を通過したアクションのみ発注を受理（spec §5.2）。
- 成績は **ルックアヘッド禁止・手数料込み・ベンチと同条件**で評価（spec §9）。
- 金額は浮動小数を使わず `decimal.js` で計算（CLAUDE.md §0）。

## 依存方向（CLAUDE.md §0 / §4.3 / §8）
- `@stonks/contracts`（型・IF）と `@stonks/core-domain` にのみ依存。
- **発注は `TradingEngine` IF、状態は `PortfolioService` IF、価格は `PriceProvider` IF 経由のみ**。
  `@stonks/trading-engine` / `@stonks/portfolio` / `@stonks/market-data` を直接 import しない。
- 永続化は内部の `AgentDecisionRepository` / `PerformanceSnapshotRepository` IF に対して行い、
  `@stonks/db` を直接 import しない。Phase 1 は in-memory 実装、実 DB 結線は api 側 Phase 2 で DI 差し替え。

### RiskGuard の状態注入について
contracts の `RiskGuard.check(accountId, action)` は同期・引数が固定のため、現金・集中度・日次累計などの
状態は `AgentTradingService` が `at` 時点の同期スナップショット（`RiskState`）として構築し注入する。
これにより契約の形状を変えずにルックアヘッドなしの状態依存ガードを実現している。

## 使い方
```ts
import {
  DefaultAgentTradingService,
  DefaultPerformanceEvaluator,
  InMemoryAgentDecisionRepository,
} from "@stonks/agent-trader";

const svc = new DefaultAgentTradingService({
  profiles,        // AgentProfileProvider（db 非依存の最小 IF）
  portfolio,       // PortfolioService IF
  priceProvider,   // PriceProvider IF
  tradingEngine,   // TradingEngine IF
  decisions: new InMemoryAgentDecisionRepository(),
});

await svc.submitDecision({
  agentProfileId: "p-1",
  accountId: "acc",
  rationale: "RSI が売られ過ぎなので打診買い",
  actions: [{ kind: "ORDER", order: { /* PlaceOrderCommand */ } }],
  inputContext: { rsi: 25 },
});
```

テストは `fakes.ts`（FakeTradingEngine / FakePortfolioService / FakePriceProvider / FakeAgentProfileProvider）を
注入し、実ドメインに依存せず検証する（CLAUDE.md §3）。

## コマンド
```
corepack pnpm@9.12.0 --filter @stonks/agent-trader typecheck
corepack pnpm@9.12.0 --filter @stonks/agent-trader test
corepack pnpm@9.12.0 --filter @stonks/agent-trader lint
```
