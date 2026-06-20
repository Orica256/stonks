# @stonks/api

NestJS の統合・結線層（spec §4.1 / §6.8）。各ドメインパッケージ
（market-data / trading-engine / portfolio / analytics）を DI でマウントし、
REST + SSE を公開する。**横依存は作らず、結合は contracts の IF 経由のみ**（spec §4.3）。

## 責務

- ドメインモジュールの DI 結線（プロバイダ/コントローラ）。
- contracts の `DomainError` を HTTP ステータスにマップ（`DomainExceptionFilter`）。
- 本番は `@stonks/db`(Prisma) バックのリポジトリ、ローカル/テストは各パッケージの
  in-memory 実装（`DATABASE_URL` の有無で自動切替）。

## 公開エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/instruments?q=&market=` | 銘柄検索 |
| GET | `/instruments/:id/bars?timeframe=&from=&to=` | OHLCV バー取得 |
| GET | `/instruments/:id/quote` | 最新気配 |
| GET | `/quotes/stream?ids=a,b` | 価格ストリーム（SSE・短間隔ポーリング） |
| POST | `/accounts/:id/orders` | 発注（`PlaceOrderCommand`） |
| DELETE | `/orders/:id` | 注文取消 |
| POST | `/orders/evaluate` | オープン注文の明示評価（約定→portfolio 反映） |
| GET | `/accounts/:id/trades` | 取引履歴 |
| GET | `/accounts/:id/positions` | 保有（評価額・含み損益込み） |
| GET | `/accounts/:id/summary` | 総資産サマリ |
| GET | `/accounts/:id/history?from=&to=` | エクイティ推移 |
| POST | `/instruments/:id/indicators` | バー取得→テクニカル指標計算 |

> agent-decisions / performance / backtests（spec §6.8 の AI・バックテスト系）は
> Phase 2/3 で agent-trader / backtest を投入する際に追加する。

## 結線の要点

- **market-data**: `createMarketDataProvider({ env })` が env からアダプタ構成を組む
  （Finnhub/J-Quants は鍵があれば、無ければ Yahoo。FX は exchangerate.host）。返る
  `MarketDataRegistry` は MarketDataProvider / PriceProvider / FxProvider を一体で満たす。
- **trading-engine**: `StandardTradingEngine` を `OrderRepository` + contracts の
  `AccountStateProvider` / `InstrumentResolver` + 既定 Fee/Fill モデルで構成。
  `evaluateOpenOrders` は `POST /orders/evaluate`・定期インターバル
  （`ORDER_EVAL_INTERVAL_MS`）で駆動する最小実装。
- **約定の流し込み**: 評価で生じた `Trade` を `portfolio.applyTrade` に流す。取引履歴は
  portfolio が applyTrade で記録するため、`GET /accounts/:id/trades` は
  `PortfolioService.getTrades` に委譲する（旧 `TradeLog` ブリッジは B2 で廃止）。
- **AccountStateProvider**: trading-engine の現金/保有読み取りは portfolio の
  `RepositoryAccountStateProvider`（contracts `AccountStateProvider` 実装）で構成する
  （B2 で正式 IF 化。旧 `PortfolioAccountStateProvider` 結線ブリッジは廃止）。
- **portfolio**: `DefaultPortfolioService` を `PortfolioRepository` + PriceProvider + FxProvider +
  `baseCurrency` で構成。
- **analytics**: `IndicatorService`（純粋関数）にバーを渡して指標を計算。

### 銘柄 ID 体系（重要）

`EXCHANGE:SYMBOL`（例 `TSE:7203` / `NASDAQ:AAPL`）が `Instrument.id` の正準形式として
contracts（`InstrumentId` / B1）で確定済み。`PriceProvider.getLatestPrice` はこの形式から
通貨を導出し、db の `Instrument.id` も同形式をそのまま格納する（cuid 自動採番は使わない）。

## 環境変数

`.env.example` を参照。`DATABASE_URL` 未設定なら in-memory 実装で起動する。
秘密情報（API キー）はログ・レスポンスに出さない（CLAUDE.md §7）。

## 実行

```
corepack pnpm@9.12.0 install
corepack pnpm@9.12.0 --filter @stonks/db generate   # Prisma 型生成（DB バック型整合に必要）
corepack pnpm@9.12.0 --filter @stonks/api typecheck
corepack pnpm@9.12.0 --filter @stonks/api test       # ローカル DB 不要（in-memory + フェイク）
corepack pnpm@9.12.0 --filter @stonks/api dev         # 開発起動（tsx）
```

## テスト方針

ローカル Postgres 無しで green になる。本番リポジトリ（Prisma バック）は typecheck で
型整合を担保し、結線/コントローラの統合シナリオは in-memory 実装＋フェイク market-data で
検証する（`test/integration.test.ts`: 検索→発注→評価→約定→ポジション/サマリ→取消）。
