# @stonks/contracts

全モジュールの**結合点（唯一の真実）**。型・Zod スキーマ・サービスインターフェース・エラー型を集約する（CLAUDE.md §0）。

## 責務
- ドメインの値・エンティティの Zod スキーマと、そこから導出した型（`z.infer`）を提供。
- モジュール間インターフェース（`MarketDataProvider`, `PriceProvider`, `TradingEngine`, `PortfolioService`, `AccountStateProvider`, `InstrumentResolver`, `IndicatorService`, `BacktestRunner`, `AgentTradingService`, `RiskGuard`, `PerformanceEvaluator`）を定義。
- 共通エラー型 `DomainError`。
- 銘柄 ID の正準形式 `InstrumentId`（`EXCHANGE:SYMBOL`）と helper `buildInstrumentId` / `parseInstrumentId`（B1）。

## 主要な型/IF（B1–B4 反映）
- `InstrumentId` — `Instrument.id` の正準形式（`^(TSE|NYSE|NASDAQ):…$`）。`Instrument.id` はこの型。
- `Position.currency: Currency` — 建玉通貨を自己記述的に保持（B3）。
- `PortfolioService` — `deposit` / `withdraw`（B4）、`getTrades` / `getRealizedPnl`（B2）を含む。
- `AccountStateProvider` — 現金/保有の読み取り IF（B2。trading-engine の発注前チェックが利用）。
- `InstrumentResolver` — 銘柄解決（id→Instrument）の最小 IF（B2。agent-trader の symbol 解決等）。

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
