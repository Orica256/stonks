# 契約バックログ（共有事項）

> Phase 1・Phase 2 の並列実装で各モジュール担当が見つけた **`packages/contracts` の不足・不整合・要検討事項**を集約したもの。
> 実装側は勝手に契約を変えず（CLAUDE.md §0）、ここに申し送り、`domain-architect` が調停して反映する。
> ステータス: **未対応（次に着手すべき設計タスク）**

## 優先度高（複数モジュールが回避策で凌いでいる＝早く正式化したい）

### B1. 銘柄 ID 体系の正準化 `EXCHANGE:SYMBOL`
- market-data は銘柄を `EXCHANGE:SYMBOL`（例 `TSE:7203`, `NASDAQ:AAPL`）で識別・通貨導出している。
- 一方 `db` の `Instrument.id` は `cuid()` 既定。apps/api は突き合わせのため **`Instrument.id` に `EXCHANGE:SYMBOL` を格納**する前提で結線（cuid 不使用）。
- → contracts/db で「`Instrument.id` の正準形式」を確定する（`EXCHANGE:SYMBOL` を正式採用するか、別途 `instrumentKey` を設けるか）。trading-engine・portfolio・agent-trader すべてに影響。

### B2. 読み取り系インターフェースが contracts に無い
複数モジュールが内部ポートを発明して凌いでいる。contracts に正式な読み取り IF を定義したい:
- **現金/保有の読み取り**: trading-engine が `AccountStateProvider`（内部）で発注前チェック。apps/api が portfolio へブリッジ。
- **取引履歴の一覧**: `PortfolioService` に無く、apps/api が `TradeLog`（内部）を用意。
- **実現損益（trade 単位）一覧**: agent-trader の勝率計算に必要だが無く、エクイティ系列の上昇比率で代理。
- **銘柄解決（symbol/通貨）**: agent-trader の `AgentObservation.positions[].symbol` が取れず `instrumentId` でフォールバック。portfolio も内部に instrument→currency マップを保持。

### B3. `Position.currency` フィールド追加
- `PositionView.marketValue`/`unrealizedPnl` は `Money`（通貨付き）だが、`Position` は `avgCost: DecimalString` のみで通貨を持たない。
- portfolio は内部 instrument→currency マップで回避中。`Position` に `currency: Currency` を持たせれば自己記述的になり回避策が消える。

### B4. 入出金（deposit/withdraw）の責務
- `applyTrade` で現金=台帳整合を保つには現金の出所が要る。portfolio は契約外の具象 `deposit()` を追加して凌いでいる。
- → 入出金を `PortfolioService`（または口座/現金サービス）として契約に明示する。

## 優先度中

### B5. `PlaceOrderCommand` に成行買いの予算上限
- 成行買いは発注時に約定価格が未確定で事前現金チェックができない（現状は約定時に portfolio 側で反映）。
- 任意の `estimatedPrice` か `maxNotional` があると事前チェックを厳密化できる。

### B6. `FillModel.tryFill` がステートレス
- STOP/STOP_LIMIT のトリガ判定は本質的にステートフル（一度発火で維持）。trading-engine は engine 側でトリガ状態を管理して回避。
- backtest と約定ロジックを共有するなら、トリガ判定込みの評価 IF を契約に明示すると再利用しやすい。

### B7. 手数料の表現 `Money` 統一
- `Trade.fee` は `DecimalString` 単体、`FeeModel.calculate` は `{ fee: Money }`。currency は Trade 側にあり整合は取れているが、`Money` に統一する余地。

### B8. `RiskGuard.check` のシグネチャ
- 現在 同期＋`(accountId, action)` のみ。現金/集中度/日次累計の判定に口座状態が要るため、agent-trader は内部 `RiskState` を構築して注入。
- `check(accountId, action, context)` か `Promise` 戻り化を検討すると、状態取得を RiskGuard 内に閉じられる。

### B9. 成績評価の基準点
- `PerformanceSnapshot.cumulativeReturn` は初期エクイティ点が必要。portfolio は約定ごとに EquityPoint を記録するため、入金直後の基準点が無いと基準が最初の約定後になる。入金時点のスナップショットがあると正確。
- `getHistory` のエクイティ意味（mark-to-market か cost basis か）が未定義。現状は cost basis（provider 非依存・決定的）。

## 優先度低（任意・型の締め付け）

### B10. `IndicatorResult.ts` の型
- `z.array(z.string())` で任意文字列。入力 `PriceBar.ts` は `Timestamp` なので `ts: z.array(Timestamp)` に締めても良い（任意）。

### B11. `IndicatorSpec.params` の discriminated union 化
- 現在 `z.record(z.number())` で MACD の fast/slow/signal も同居。kind 別 union 化で型安全性が上がる（現契約でも実装可）。

### B12. `CorporateAction` 取得 IF
- 型はあるが `MarketDataProvider` に取得メソッドが無い（分割/配当の取り込み）。Phase 1 で IF 追加を提案。

## ツール債務（契約ではないが要対応）

### T1. ESLint 設定の配線が不統一
- `packages/{portfolio,market-data,agent-trader}` には `eslint.config.js` があるが、`contracts/core-domain/analytics/trading-engine/db` には無く `pnpm -r lint` が一部失敗する（typecheck/test は全 green）。
- → `packages/config` の共有 flat config を各パッケージで継承する `eslint.config.js` を統一配置（または root 集約）。`domain-architect`/config の領域。
