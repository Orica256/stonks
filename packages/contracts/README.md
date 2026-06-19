# @stonks/contracts

全モジュールの**結合点（唯一の真実）**。型・Zod スキーマ・サービスインターフェース・エラー型を集約する（CLAUDE.md §0）。

## 責務
- ドメインの値・エンティティの Zod スキーマと、そこから導出した型（`z.infer`）を提供。
- モジュール間インターフェース（`MarketDataProvider`, `PriceProvider`, `TradingEngine`, `PortfolioService`, `IndicatorService`, `BacktestRunner`, `AgentTradingService`, `RiskGuard`, `PerformanceEvaluator`）を定義。
- 共通エラー型 `DomainError`。

## 入出力
- 入力: なし（純粋な型/スキーマ定義パッケージ）。
- 出力: `@stonks/contracts` からの named export（`src/index.ts` バレル）。

## ルール
- 実装ロジックは置かない。スキーマと型と IF のみ。
- 変更は `domain-architect` が調停（横断影響があるため）。

## コマンド
```
pnpm --filter @stonks/contracts test       # 契約遵守テスト
pnpm --filter @stonks/contracts typecheck
```
