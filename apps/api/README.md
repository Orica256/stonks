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
| GET | `/instruments/:id/corporate-actions?from=&to=` | 配当/分割の取得（`exDate` が範囲内の `CorporateAction[]`。range 未指定は直近 1 年。未対応プロバイダは 501） |
| GET | `/quotes/stream?ids=a,b` | 価格ストリーム（SSE・短間隔ポーリング） |
| POST | `/accounts/:id/orders` | 発注（`PlaceOrderCommand`） |
| DELETE | `/orders/:id` | 注文取消 |
| POST | `/orders/evaluate` | オープン注文の明示評価（約定→portfolio 反映） |
| GET | `/accounts/:id/trades` | 取引履歴 |
| GET | `/accounts/:id/positions` | 保有（評価額・含み損益込み） |
| GET | `/accounts/:id/summary` | 総資産サマリ |
| GET | `/accounts/:id/history?from=&to=` | エクイティ推移 |
| GET | `/accounts/:id/tax?from=&to=` | 譲渡益課税の概算（通貨別 `CapitalGainsTaxEstimate[]`。既定率 20.315%。range 未指定は年初来） |
| POST | `/accounts/:id/corporate-actions` | コーポレートアクション反映（body=`CorporateAction`。配当→現金/台帳、分割→ポジション調整。未対応サービスは 501） |
| POST | `/instruments/:id/indicators` | バー取得→テクニカル指標計算 |
| POST | `/backtests` | バックテスト実行（`RunBacktestRequest` → `BacktestResult`。損益・最大DD・シャープ・勝率） |
| POST | `/agents` | AgentProfile 作成（id/createdAt はサーバ採番） |
| GET | `/agents` | AgentProfile 一覧（agent-runner がプロファイルを権威として取得） |
| GET | `/agents/:id` | AgentProfile 単体取得（未登録は 404） |
| POST | `/accounts/:id/agent-decisions` | AI 発注（`rationale` 必須 → AgentDecision 記録＋発注委譲） |
| GET | `/accounts/:id/decisions` | 意思決定ログ閲覧（監査証跡） |
| GET | `/accounts/:id/observation` | 自律ループ向け観測（市況/保有/成績の要約） |
| GET | `/accounts/:id/performance?range=&from=&to=&benchmark=` | 成績スナップショット＋ベンチ比較（`{ snapshot, comparison, comparisonResult }`。`comparison` は後方互換で成立時のみ非 null、`comparisonResult` は不成立理由を型付き提示） |

> agent 系は agent-trader（`AgentTradingService` / `PerformanceEvaluator`）へ委譲し、
> trading-engine / portfolio を直接呼ばない（spec §4.3 / §8）。`agent-decisions` は
> rationale 必須で、発注は必ず AgentDecision に紐づく（spec §5.2 監査証跡）。
> `performance` のベンチ比較は `PerformanceEvaluator.compareResult` 経由。比較不能でも throw を
> 握り潰して `comparison: null` にする代わりに、`comparisonResult`（`available:false` + `reason`）で
> 理由を型付き提示する（spec §2.7 P1）。
> corporate-actions の 2 本は spec §6.8 一覧外の P1 補助ルート（/history /tax と同扱い）。
> GET は market-data の `getCorporateActions`、POST は portfolio の `applyCorporateAction`（ともに
> contracts 上 optional）へ委譲し、未実装の供給先には 501 を返す（誤データを捏造しない）。

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
- **backtest**: `BacktestRunnerFactory` がリクエストの universe/range に対し market-data
  （`getBars`）と `InstrumentProvider`（`getById`）からヒストリカルデータを前取得して
  `InMemoryDataSource` に流し、`HistoricalBacktestRunner` を回す。約定は trading-engine、
  指標は analytics を backtest パッケージが再利用する（apps/api は直結しない。spec §4.3）。
- **agents 取得**: `AgentProfileStore` に `list()` を備え、`GET /agents`・`GET /agents/:id`
  でプロファイルを返す（agent-runner が env 代替なくプロファイルを権威取得するため）。

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
