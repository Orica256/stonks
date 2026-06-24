# 株取引シミュレーター（ペーパートレード）設計書

> ステータス: **ドラフト v0.1（レビュー待ち）**
> このドキュメントはオーナーの承認後に実装フェーズへ進む前提です。

---

## 1. プロダクト概要

実際の株価データをもとに仮想資金で売買を行うペーパートレード Web アプリ。
個人利用だが、機能・構成は本格的かつ大規模を志向する。

### 1.1 スコープ確定事項（ヒアリング結果）

| 項目 | 決定 | 備考 |
|---|---|---|
| 対象市場 | **日米両方** | 東証（TSE）/ NYSE / NASDAQ。通貨・取引時間・銘柄コード体系を市場ごとに抽象化 |
| 技術スタック | **おまかせ（推奨構成）** | TypeScript モノレポを採用（後述） |
| データ鮮度 | **無料の範囲で最大速度** | 複数無料APIのアダプタ＋フォールバック。US は準リアルタイム、JP は EOD 中心 |
| 機能範囲 | **現実の機能を可能な限り再現** | 注文種別・約定・手数料・損益・税・テクニカル・バックテストまでフルスコープ |

### 1.2 非ゴール

- 実際の金銭の入出金・実発注（ブローカー連携）は行わない。あくまでシミュレーション。
- 投資助言・推奨は提供しない。
- マルチユーザ / マルチテナント SaaS は非対象（**個人ユーザーのみ**。単一ローカルユーザを前提とする。ただしアカウント＝口座概念は持ち複数ポートフォリオを並走可）。

### 1.3 制約（厳守）

> **完全ローカル・無料運用を本プロジェクトの絶対制約とする。** 設計・実装・依存選定はすべてこの制約に従うこと。

- **完全ローカル運用**: アプリは個人の PC 上（ローカル + Docker Compose）で完結させる。クラウド常駐・有料ホスティング・マネージドサービスを前提にしない。
- **無料運用**: ランニングコストが発生する選択肢を採らない。採用する OSS・ライブラリ・株価/為替 API はすべて無料枠の範囲で利用する。
- **有料サービス禁止**: 有料 API プラン、課金が前提のリアルタイム配信、従量課金のクラウド DB/インフラ等は採用しない。無料枠を超える利用が必要になった場合は、実装で勝手に有料化せず必ずオーナーに相談する。
- **外部 API は無料枠を尊重**: レート制限内での取込・キャッシュ・フォールバックで縮退する（spec §3.1, §9）。真のリアルタイム配信（有料が一般的）は採用せず「US=準リアルタイム / JP=EOD＋遅延」に倒す。
- **将来クラウド化の余地は残す**が、それは別途オーナー承認のうえで行う拡張であり、初期スコープには含めない。

---

## 2. 機能要件（優先度付き）

優先度: **P0 = MVP に必須 / P1 = 早期に追加 / P2 = 拡張**

### 2.1 マーケットデータ
- (P0) 銘柄マスタ（日米）の取得・検索・正規化
- (P0) 日足 OHLCV の取得・保存（ヒストリカル）
- (P0) 最新気配/直近価格の取得（US 準リアルタイム、JP は遅延/EOD）
- (P1) 分足（1m/5m/15m/1h）OHLCV
- (P1) 配当・株式分割イベントの取得と調整
- (P1) 為替レート（USD/JPY）取得（口座基軸通貨換算用。JPY/USD 両建てのため評価額算出に必須）

### 2.2 取引（トレーディングエンジン）
- (P0) 成行・指値注文
- (P0) 売買（買い/売り）、現物前提の保有数量管理
- (P0) 約定シミュレーション（価格・数量・タイムスタンプ確定）
- (P0) 手数料・スリッページのルールベース計算
- (P1) 逆指値（stop）、ストップリミット（stop-limit）
- (P1) 注文の有効期限（DAY / GTC）、部分約定、注文キャンセル
- (P1) 単元株（東証 100 株単位）/ 端株のルール、呼値（tick size）刻み
- (P2) **信用取引（ロング/ショート、保証金、金利）= 再現対象に含む**、OCO/IFD などの複合注文（実装着手は Phase 3）

### 2.3 ポートフォリオ・損益
- (P0) 保有ポジション一覧（数量・平均取得単価・評価額・含み損益）
- (P0) 現金残高（通貨別）、取引履歴
- (P1) 実現損益、リターン率、資産推移グラフ
- (P1) 税計算（譲渡益課税の概算）、配当受取
- (P2) 税ロット管理（特定/一般、取得単価計算方式）

### 2.4 分析・チャート
- (P1) ローソク足チャート（複数時間足）
- (P1) テクニカル指標（SMA/EMA/RSI/MACD/ボリンジャーバンド/出来高）
- (P2) 描画ツール、複数銘柄比較、ヒートマップ

### 2.5 バックテスト・自動売買
> **初期から設計（契約・データモデル）に織り込む**。実装着手は Phase 3 だが、Strategy/BacktestRun のスキーマと `BacktestRunner` IF は Phase 0 で確定させる。
- (P2) ルールベース戦略の定義
- (P2) ヒストリカルデータに対する戦略バックテスト（損益・最大DD・シャープレシオ等の指標）
- (P2) 仮想時間でのルール自動執行

### 2.6 アカウント
- (P0) **個人ユーザーのみ**（単一ローカルユーザ）、複数ポートフォリオ（口座）
- (P0) 口座は基軸通貨を持ち、**JPY/USD 両建ての現金残高**を保持（多通貨）
- (P1) 認証（ローカル・最小）、初期入金・リセット

### 2.7 AI エージェント取引・成績評価（★ 本機能）

Claude（LLM エージェント）自身が**シミュレーション内で売買を実行**し、その成績を測れるようにする。実マネー・実発注は伴わない（§1.2 非ゴール）。狙いは「Claude が仮想資金でどれだけ稼げるか」の検証。

- (P0) **エージェント専用口座**: 人間の口座と分離した agent-managed なアカウント（複数戦略を別口座で並走可）
- (P0) **トレーディング接点（共通 API）**: 銘柄検索・気配取得・ポートフォリオ取得・発注/取消を行う、人間 UI と同一の契約に基づく操作面
- (P0) **MCP ツールサーバー**: 上記接点を MCP ツール（`search_instruments` / `get_quote` / `get_portfolio` / `place_order` / `cancel_order` / `get_performance`）として公開。Claude Code 等の LLM が**対話しながら手動で**売買できる
- (P1) **自律エージェントループ**: アプリが定期的に市況・保有・成績を LLM に渡し、売買判断を**自動執行**する（スケジュール実行）。判断の根拠（rationale）を必ず記録
- (P0) **意思決定ログ（監査証跡）**: すべての発注に対し、いつ・どの情報で・なぜ・どのモデルが判断したかを記録。リプレイ・検証可能に
- (P0) **ライブ・フォワードテスト評価**: これからの実市況に対し仮想売買し、期間損益・リターン率・最大DD・シャープレシオ・勝率を追跡
- (P1) **ベンチマーク比較**: バイ&ホールド / 指数（例: TOPIX, S&P500）とのリターン比較、超過リターン
- (P1) **リスクガード**: 1注文/1日あたりの最大発注額、最大ポジション集中度、現金不足チェック等のガードレール（暴走防止）
- (P2) **複数モデル/戦略の比較リーグ**: 別口座で複数の戦略・モデルを並走させ成績をランキング

> **コスト注記（§1.3 と整合）**: アプリのインフラはローカル・無料のまま。ただし **(P1) 自律ループは LLM 呼び出しが発生**するため、その LLM 利用料は別途かかる（アプリの運用費ではなく開発/AI ツールのコスト）。MCP ツール経由の手動売買は、利用者の既存 Claude Code セッション内で動くため追加インフラ費は不要。自律ループの実行頻度・モデルは設定で制御し、暴走しないようガードする。

---

## 3. 技術スタック（推奨）

**単一言語（TypeScript）モノレポ**を採用。理由: 並列開発するサブエージェント間で型・契約（contracts）を共有でき、フロント/バックの境界をまたぐリファクタが安全。金融計算・テクニカル指標・バックテストも TS ライブラリで完結可能。

| レイヤ | 採用技術 | 理由 |
|---|---|---|
| モノレポ管理 | **pnpm workspaces + Turborepo** | パッケージ境界＝モジュール境界。並列ビルド/タスク |
| 言語 | **TypeScript（strict）** | 型による契約の強制 |
| フロントエンド | **Next.js (App Router) + React + TailwindCSS + shadcn/ui** | SSR/RSC、UI 生産性 |
| 状態/データ取得 | **TanStack Query + Zustand** | サーバ状態とクライアント状態の分離 |
| チャート | **lightweight-charts (TradingView OSS)** | 無料・高性能なローソク足 |
| バックエンド | **NestJS (TypeScript)** | モジュール/DI が並列開発の境界に直結。契約の明確化 |
| API スタイル | **REST（OpenAPI 生成）+ 一部 SSE/WebSocket** | 価格ストリームは SSE/WS |
| バリデーション/契約 | **Zod**（`packages/contracts` で共有） | FE/BE 単一ソース。スキーマから型生成 |
| DB | **PostgreSQL + TimescaleDB 拡張** | OHLCV 時系列を効率管理 |
| ORM | **Prisma**（マスタ系）/ 時系列は生 SQL or Drizzle 検討 | 型安全 |
| キャッシュ/キュー | **Redis + BullMQ** | データ取り込みジョブのスケジューリング/レート制御 |
| データ取り込み | **専用 worker サービス** | API レート制限内でのポーリング/バックフィル |
| テスト | **Vitest（単体）+ Playwright（E2E）** | |
| 実行環境 | **Docker Compose（Postgres/Redis）** | ローカル一発起動 |

### 3.1 データソース（無料・日米）

プロバイダ抽象化（`MarketDataProvider` インターフェース）の背後に複数アダプタを置き、**フォールバックチェーン**と**レート制御**を行う。

| プロバイダ | 対象 | 種類 | 無料枠の特徴 | 役割 |
|---|---|---|---|---|
| **Finnhub** | US 中心 | 気配/ローソク | 60 req/min、US はリアルタイム寄り、WS あり | US 準リアルタイム気配 |
| **Yahoo Finance（yfinance 相当）** | 日米両方 | 履歴/気配 | 非公式・無料・カバレッジ広（`7203.T` など） | 履歴・JP価格・フォールバック |
| **J-Quants** | JP | 履歴/財務 | 無料枠あり（要登録）、EOD 中心 | JP の権威データ・分割/配当 |
| **為替（exchangerate.host 等）** | FX | USD/JPY | 無料 | 通貨換算 |

> 注: 無料 API は利用規約・レート制限・データ遅延が変動する。アダプタ層で吸収し、設定で差し替え可能にする。鮮度の現実解は「**US=準リアルタイム（数分遅延〜WS）/ JP=EOD＋遅延**」。

### 3.2 主要な環境変数

全項目は `.env.example`（ルート＝統合運用向け / `apps/api/.env.example`＝api 単体向け）に値抜きで列挙し、`.env` に実値を入れる（コミット禁止。CLAUDE.md §4/§7）。秘密情報は設定オブジェクトに載せず、`createMarketDataProvider(env)` 等へ env をそのまま渡して露出を最小化する。代表的なものを以下に示す（既定値は実装の fallback）。

| 変数 | 読む側 | 既定 | 用途 |
|---|---|---|---|
| `DATABASE_URL` / `REDIS_URL` | api / worker / agent-runner | – | Postgres・Redis 接続（ローカル Docker Compose） |
| `FINNHUB_API_KEY` / `JQUANTS_REFRESH_TOKEN` | market-data | – | 株価プロバイダ鍵（未設定でも Yahoo で縮退） |
| `FX_API_BASE` | market-data | exchangerate.host | 為替 API のベース URL |
| `MARGIN_INITIAL_RATE` / `MARGIN_MAINTENANCE_RATE` | api（保証金ポリシー, P6） | 0.30 / 0.20 | 必要保証金率・維持保証金率（非負小数文字列） |
| `MARGIN_ANNUAL_INTEREST_RATE` / `MARGIN_ANNUAL_BORROW_RATE` | api（保証金ポリシー, P6） | 0.028 / 0.011 | 買い建て金利・売り建て貸株料（年利） |
| `MARGIN_DISALLOWED_INSTRUMENTS` | api（保証金ポリシー, P6） | 空 | 信用不可銘柄（カンマ区切り `EXCHANGE:SYMBOL`）。MARGIN 発注を拒否 |
| `MARGIN_TRADABLE_OVERRIDES` / `SHORT_MARGINABLE_OVERRIDES` | market-data（信用可否, P7.1） | 空 | 信用建て可否フラグの銘柄単位上書き（`EXCHANGE:SYMBOL[:FLAG]` カンマ区切り。FLAG 省略時=可） |
| `ANTHROPIC_API_KEY` | agent-runner（LLM, P3） | – | 自律ループ `provider=llm` 用。未設定なら HOLD にフォールバック（無課金） |
| `AGENT_RUNNER_ENABLED` / `AGENT_RUNNER_PROVIDER` / `AGENT_RUNNER_CRON` / `AGENT_RUNNER_MAX_ACTIONS` | agent-runner（自律ループ, §2.7/§9） | false / hold / `0 0 * * *` / 3 | 有効化フラグ・判断プロバイダ・頻度・1 ループ発注上限（暴走/課金防止） |
| `AGENT_LLM_MODEL` | agent-runner | claude-opus-4-8 | `provider=llm` で使う LLM モデル名 |

> 信用ポリシー・金利は**シミュレーション既定値**であり投資情報の断定ではない（§7 免責）。LLM 利用料はアプリのインフラ無料制約とは別枠で、既定 disabled・低頻度に抑える（§0/§2.7/§8）。

---

## 4. アーキテクチャ

### 4.1 全体構成

```
┌─────────────┐                      ┌─────────────────────────┐
│  Frontend    │──REST/SSE──┐         │  AI Agent (Claude 等)    │
│  (Next.js)   │            │         │  ・MCP 手動売買           │
└─────────────┘            ▼         │  ・自律ループ自動執行       │
                    ┌──────────────┐  └───────────┬─────────────┘
                    │ API Gateway   │              │ MCP tools
                    │  (NestJS)     │◀── REST ─────┤ (mcp-server)
                    │ =アプリ層      │              │
                    └──────┬───────┘              │
                           │ (in-process modules / DI)
   ┌────────────┬──────────┼─────────┬──────────┬──────────┬───────────┐
   ▼            ▼          ▼         ▼          ▼          ▼           ▼
instruments market-data trading-  portfolio  analytics  backtest  agent-trader
(銘柄マスタ) (価格/取込)  engine    (保有/損益) (指標)    (戦略検証) (意思決定ログ/
                       (注文/約定)                               成績評価/ガード)
   │            │                                                      
   ▼            ▼                                                      
┌───────────────────────────────────────────────────────────────────────┐
│                  PostgreSQL + TimescaleDB / Redis                       │
└───────────────────────────────────────────────────────────────────────┘
        ▲
   ingestion-worker (BullMQ): スケジュール取込・バックフィル・レート制御
   agent-runner    (BullMQ): 自律ループのスケジュール実行（P1）
```

AI エージェントは**人間のフロントと同じ API/契約**を叩く別クライアントとして扱う。MCP サーバーはその API の薄いラッパで、LLM がツールとして呼べる形に公開する。

すべてのモジュールは `packages/contracts`（Zod スキーマ＋型＋サービスインターフェース）に依存し、**互いには直接依存せずインターフェース経由で結合**する（依存性逆転）。

### 4.2 ディレクトリ構成（モノレポ）

```
stonks/
├─ apps/
│  ├─ web/                    # Next.js フロントエンド
│  ├─ api/                    # NestJS API（モジュールをマウント）
│  ├─ ingestion-worker/       # 価格取込ワーカー（BullMQ consumer）
│  ├─ mcp-server/             # ★ MCP ツールサーバー（LLM が売買ツールを呼ぶ口）
│  └─ agent-runner/           # ★ 自律エージェントループ実行（BullMQ, P1）
├─ packages/
│  ├─ contracts/              # ★ 共有契約: Zod スキーマ / 型 / サービス IF / エラー型
│  ├─ core-domain/            # ドメイン純粋ロジック（通貨/数量/価格の値オブジェクト等）
│  ├─ market-data/            # 価格・銘柄プロバイダ抽象 + アダプタ群
│  ├─ trading-engine/         # 注文受付・約定シミュレーション・手数料計算
│  ├─ portfolio/              # ポジション・損益・評価
│  ├─ analytics/              # テクニカル指標計算
│  ├─ backtest/               # 戦略定義・バックテストランナー
│  ├─ agent-trader/           # ★ AI 売買の意思決定ログ・成績評価・リスクガード
│  ├─ db/                     # Prisma スキーマ / マイグレーション / リポジトリ
│  └─ config/                 # 環境設定・ESLint/TS 共有設定
├─ docs/
│  └─ spec.md
├─ .claude/
│  └─ agents/                 # 並列開発用サブエージェント定義
├─ docker-compose.yml
├─ turbo.json
├─ pnpm-workspace.yaml
└─ CLAUDE.md
```

### 4.3 依存方向（重要・循環禁止）

```
contracts  ◀── すべてが依存（最上流・最初に確定）
core-domain ◀── 各ドメインパッケージが依存
db         ◀── 各リポジトリ実装が依存

market-data ──▶ contracts, core-domain, db
trading-engine ─▶ contracts, core-domain  (価格は PriceProvider IF 経由)
portfolio ──▶ contracts, core-domain, db
analytics ──▶ contracts, core-domain      (価格は入力として受け取る)
backtest ──▶ contracts, core-domain, trading-engine(ロジック), analytics
agent-trader ─▶ contracts, core-domain   (発注は TradingEngine IF、状態は PortfolioService IF 経由)
apps/api ──▶ 上記すべてを DI でマウント
apps/mcp-server ─▶ contracts ＋ API(HTTP) のみ（薄いラッパ。ドメインを直接 import しない）
apps/agent-runner ─▶ contracts ＋ agent-trader ＋ API(HTTP)
apps/web ──▶ contracts（型のみ）＋ HTTP
```

ルール: **横方向（ドメイン同士）の直接 import を禁止**。必要な場合は `contracts` のインターフェースを介す（例: trading-engine は `market-data` を import せず `PriceProvider` IF に依存）。agent-trader も同様に TradingEngine / PortfolioService の IF 経由でのみ発注・状態取得する。

---

## 5. データモデル

通貨・数量・価格は値オブジェクトで扱い、浮動小数の誤差を避けるため**金額は整数（最小単位）または Decimal 文字列**で保持する。

### 5.1 主要エンティティ（論理）

```
Instrument（銘柄）
  id, symbol, exchange(TSE|NYSE|NASDAQ), market(JP|US),
  name, currency(JPY|USD), type(STOCK|ETF), lotSize, tickRules, isActive
  (信用拡張: marginTradable?, shortMarginable?  ── 貸借区分上の信用買建/売建可否。NULL=不明。
              ポリシー設定上の可否=MarginPolicyProvider.getMarginPolicy() とは別レイヤ)

PriceBar（OHLCV 時系列, TimescaleDB hypertable）
  instrumentId, timeframe(1m|5m|15m|1h|1d), ts,
  open, high, low, close, volume   ── PK(instrumentId, timeframe, ts)

Quote（最新気配）
  instrumentId, last, bid, ask, ts, source

CorporateAction（配当/分割）
  instrumentId, type(DIVIDEND|SPLIT), exDate, value

FxRate
  base(USD), quote(JPY), rate, ts

Account（口座/ポートフォリオ）
  id, userId, name, baseCurrency, createdAt,
  managedBy(HUMAN|AGENT), agentProfileId?     ── AGENT 口座は人間口座と分離
CashBalance
  accountId, currency, amount          ── 通貨別残高

Position（保有）
  id, accountId, instrumentId, quantity, avgCost, openedAt
  (信用拡張: side(LONG|SHORT), margin)
  一意キー: (accountId, instrumentId, side, marginType)  ── CASH/MARGIN 同方向建玉を分離（Phase 5）

Order（注文）
  id, accountId, instrumentId, side(BUY|SELL),
  type(MARKET|LIMIT|STOP|STOP_LIMIT), quantity, filledQuantity,
  limitPrice?, stopPrice?, timeInForce(DAY|GTC),
  status(PENDING|PARTIALLY_FILLED|FILLED|CANCELLED|REJECTED|EXPIRED),
  createdAt, updatedAt

Trade / Execution（約定 = 取引履歴）
  id, orderId, accountId, instrumentId, side, quantity, price,
  fee, currency, executedAt

CashLedger（入出金・配当・手数料台帳）
  id, accountId, type(DEPOSIT|WITHDRAW|FEE|DIVIDEND|TAX|REALIZED_PNL),
  currency, amount, refId?, ts

RealizedPnl
  id, accountId, instrumentId, quantity, costBasis, proceeds,
  realized, currency, closedAt

TaxLot（税ロット, P2）
  id, accountId, instrumentId, quantity, costBasis, acquiredAt, method

Watchlist / WatchlistItem
  id, accountId, name / instrumentId

Strategy / BacktestRun（P2）
  戦略定義(JSON ルール) / 実行結果(指標・エクイティカーブ)

── AI エージェント取引（§2.7）──

AgentProfile（エージェント設定）
  id, name, model, strategyPrompt?, mode(MANUAL_MCP|AUTONOMOUS),
  schedule?(cron), riskLimits(json), enabled, createdAt

AgentDecision（意思決定ログ = 監査証跡）
  id, agentProfileId, accountId, ts, model,
  inputContext(json: 市況/保有/成績のスナップショット),
  rationale(text), proposedActions(json),
  resultOrderIds(string[])              ── 発注に必ず1件ひも付く

PerformanceSnapshot（成績の時系列）
  accountId, ts, equity, cash, positionsValue,
  cumulativeReturn, maxDrawdown, sharpe, winRate

Benchmark / BenchmarkPoint
  id, name(例 TOPIX/S&P500), instrumentId? / accountId, ts, indexedReturn
```

### 5.2 不変条件（invariants）

- ポジション数量と取引履歴の合計は常に整合する（trade の積み上げ＝position）。
- 現金残高は CashLedger の合計と一致する（イベントソース的整合）。
- 注文の `filledQuantity <= quantity`。`FILLED` は `filledQuantity == quantity`。
- 売り注文数量は保有数量を超えない（現物。信用は別ルール）。
- AGENT 口座の発注は必ず 1 件以上の `AgentDecision`（rationale 付き）にひも付く（監査証跡の欠落を許さない）。
- AGENT 口座の発注は `AgentProfile.riskLimits` のガードを通過したもののみ受理される。

---

## 6. モジュール契約（インターフェース）

各モジュールは下記 IF を `packages/contracts` で公開。**実装はモジュール内、契約は contracts** に置くことで並列開発時の結合点を一点に集約する。

### 6.1 market-data
```ts
interface MarketDataProvider {
  searchInstruments(q: string, market?: Market): Promise<Instrument[]>;
  getQuote(instrumentId: string): Promise<Quote>;
  getBars(req: { instrumentId; timeframe; from; to }): Promise<PriceBar[]>;
  getCorporateActions?(req: { instrumentId; from; to }): Promise<CorporateAction[]>; // 配当/分割（P1。optional）
  // 任意: streamQuotes(ids): AsyncIterable<Quote>
}
interface PriceProvider {                 // 他モジュールが価格を得る最小 IF
  getLatestPrice(instrumentId: string, at?: Date): Promise<Money>;
}
```
入力: 銘柄ID/検索語/期間 → 出力: 正規化済み Instrument/Quote/PriceBar。
責務: プロバイダ差異の吸収、レート制御、キャッシュ、永続化トリガ。

### 6.2 trading-engine
```ts
interface TradingEngine {
  placeOrder(cmd: PlaceOrderCommand): Promise<Order>;     // バリデーション→受付
  cancelOrder(orderId: string): Promise<Order>;
  // マッチング: 価格更新やティックで評価し約定を生成
  evaluateOpenOrders(ctx: { now: Date; priceProvider: PriceProvider }): Promise<Trade[]>;
  // 複合注文（OCO/IFD/bracket。P2。optional）。片約定で他方取消／親約定で子発効をカスケード
  placeBracketOrder?(cmd: PlaceBracketOrderCommand): Promise<Order[]>;
  cancelOrderGroup?(linkGroupId: string): Promise<Order[]>;            // グループ一括取消（P2。optional）
}
interface FeeModel { calculate(input): { fee: Money } }    // 市場別手数料
interface FillModel { tryFill(order, marketPrice): Fill | null } // 約定/スリッページ
```
入力: 注文コマンド・価格 → 出力: Order 状態遷移・Trade。
責務: 注文ライフサイクル、約定ルール、手数料/スリッページ。**価格は PriceProvider 経由**で取得し market-data に直接依存しない。

### 6.3 portfolio
```ts
interface PortfolioService {
  applyTrade(trade: Trade): Promise<void>;        // ポジション/現金/台帳更新
  getPositions(accountId): Promise<PositionView[]>; // 評価額・含み損益込み
  getSummary(accountId): Promise<PortfolioSummary>; // 総資産・実現/含み損益
  getHistory(accountId, range): Promise<EquityPoint[]>;
  deposit(accountId, amount, at?): Promise<void>;   // 入金（CashLedger DEPOSIT 整合。B4）
  withdraw(accountId, amount, at?): Promise<void>;  // 出金（残高不足は拒否。B4）
  getTrades(accountId): Promise<Trade[]>;           // 取引履歴一覧（B2）
  getRealizedPnl(accountId): Promise<RealizedPnl[]>;// 実現損益（trade 単位。B2）
  getTaxLots?(accountId, openOnly?): Promise<TaxLot[]>;                 // 税ロット（P2。optional）
  estimateCapitalGainsTax?(accountId, range): Promise<CapitalGainsTaxEstimate[]>; // 譲渡益課税概算（P1。optional）
  applyCorporateAction?(accountId, action): Promise<void>;             // 配当受取/分割調整（P1。optional）
}
```
入力: Trade / 評価用価格 → 出力: ポジション・損益ビュー。
責務: 保有・現金・損益の整合維持、評価額算出（PriceProvider 利用）。

### 6.4 analytics
```ts
interface IndicatorService {
  compute(req: { bars: PriceBar[]; indicators: IndicatorSpec[] }): IndicatorResult;
}
```
入力: OHLCV 配列＋指標指定 → 出力: 指標系列。**純粋関数**（副作用なし、DB 非依存）。

### 6.5 backtest（P2）
```ts
interface BacktestRunner {
  run(req: { strategy: StrategyDef; range; initialCash }): Promise<BacktestResult>;
}
```
trading-engine の約定ロジックと analytics を再利用し、仮想時間で実行。

### 6.6 agent-trader（§2.7）
```ts
interface AgentTradingService {
  // AI の発注。必ず decision(rationale 等) を伴い、リスクガード通過後に TradingEngine へ委譲
  submitDecision(input: {
    agentProfileId: string; accountId: string;
    rationale: string; actions: AgentAction[];        // BUY/SELL/CANCEL/HOLD
    inputContext: unknown;                             // 判断材料のスナップショット
  }): Promise<{ decisionId: string; orders: Order[] }>;
  // 自律ループが LLM に渡す観測（市況/保有/成績の要約）
  buildObservation(accountId: string): Promise<AgentObservation>;
}
interface RiskGuard {                                   // 暴走防止
  check(accountId: string, action: AgentAction): { ok: boolean; reason?: string };
}
interface PerformanceEvaluator {
  snapshot(accountId: string, at: Date): Promise<PerformanceSnapshot>;
  compare(accountId: string, benchmark: BenchmarkId, range): Promise<BenchmarkComparison>; // 不成立は throw
  compareResult(accountId, benchmark, range): Promise<BenchmarkComparisonResult>; // 成立/不成立(理由付き)を返す
}
```
入力: AI の意思決定/観測要求 → 出力: 監査ログ＋発注（TradingEngine 委譲）、成績指標。
責務: 意思決定ログの記録、リスクガード、成績評価・ベンチ比較。**発注は TradingEngine IF、状態は PortfolioService IF 経由**で行い、それらを直接 import しない。

### 6.7 MCP ツール（apps/mcp-server）
API の薄いラッパとして以下を LLM ツールとして公開:
```
search_instruments(q, market?)        get_quote(instrumentId)
get_portfolio(accountId)              get_performance(accountId, range?)
place_order(accountId, order, rationale)   cancel_order(orderId)
```
`place_order` は `rationale` 必須（→ AgentDecision を生成）。ドメインは直接呼ばず API 経由。

### 6.8 API（apps/api）
REST（OpenAPI 公開）。代表エンドポイント:
```
GET  /instruments?q=&market=
GET  /instruments/:id              (単一銘柄取得。未存在は 404)
GET  /instruments/:id/bars?timeframe=&from=&to=
GET  /instruments/:id/quote
GET  /instruments/:id/margin-requirement?side=&quantity=&price=&marginType=  (必要保証金プレビュー。信用建て前提)
GET  /instruments/:id/corporate-actions?from=&to=  (配当/分割イベント。P1)
POST /instruments/:id/indicators      (テクニカル指標の計算。OHLCV→指標系列)
GET  /quotes/stream            (SSE)
POST /accounts/:id/orders
GET  /accounts/:id/orders?open=    (注文一覧。open=true でオープン/待機のみ)
POST /accounts/:id/orders/bracket  (複合注文 OCO/IFD/bracket の発注。P2)
DELETE /orders/:id
DELETE /orders/groups/:id          (linkGroupId 単位の一括取消。P2)
POST /orders/evaluate              (オープン注文を現在価格で評価し約定生成)
GET  /accounts/:id/positions
GET  /accounts/:id/summary
GET  /accounts/:id/trades
GET  /accounts/:id/history          (資産推移=エクイティカーブ)
GET  /accounts/:id/tax?from=&to=    (譲渡益課税の概算。P1。既定=年初来)
POST /accounts/:id/corporate-actions  (配当受取/分割調整の適用。P1)
POST /backtests
POST /agents                          (AgentProfile 作成)
GET  /agents/:id                       (AgentProfile 取得)
POST /accounts/:id/agent-decisions    (AI 発注 = rationale 付き)
GET  /accounts/:id/decisions          (意思決定ログ閲覧)
GET  /accounts/:id/observation        (自律ループ向け観測=市況/保有/成績の要約)
GET  /accounts/:id/performance?range= (成績・ベンチ比較)
```

---

## 7. 並列開発計画

### 7.1 フェーズ
- **Phase 0（直列・最初に固める）**: `contracts` と `core-domain` と `db` スキーマを確定。← 全並列作業の前提
- **Phase 1（並列）**: market-data / trading-engine / portfolio / analytics / web の骨組みを契約に対してモック実装で並行開発。
- **Phase 2（統合）**: apps/api で結線、E2E。**agent-trader + mcp-server（MANUAL_MCP 手動売買）と成績評価**もここで投入（ライブ・フォワードテストを最短で開始するため）。
- **Phase 3（拡張）**: agent-runner（AUTONOMOUS 自律ループ）、ベンチ比較の拡充、backtest / 信用取引 / 税ロット / 高度チャート。

### 7.2 低結合の担保
- 横依存禁止（§4.3）。各モジュールは契約のモック/フェイクに対して単体テスト可能。
- 結合点は `contracts` の 1 パッケージのみ。契約変更は「契約オーナー」エージェントが調停。
- 各モジュールは自前の `*.contract.test.ts`（契約遵守テスト）を持つ。

### 7.3 完了の定義（DoD）
- 型チェック・lint・単体テスト green。
- 公開 IF が contracts と一致（契約テスト green）。
- README に責務・入出力・実行方法を記載。

---

## 8. エージェント役割分担（`.claude/agents/`）

| エージェント | 担当パッケージ | 責務 |
|---|---|---|
| `domain-architect` | contracts, core-domain, db | 契約・データモデルの単独オーナー。変更調停。最初に稼働 |
| `market-data-dev` | market-data, ingestion-worker | プロバイダ抽象・アダプタ・取込・レート制御 |
| `trading-engine-dev` | trading-engine | 注文ライフサイクル・約定・手数料 |
| `portfolio-dev` | portfolio | 保有・現金・損益の整合 |
| `analytics-dev` | analytics | テクニカル指標（純粋関数） |
| `backtest-dev` | backtest | 戦略・バックテスト（Phase 3） |
| `agent-trader-dev` | agent-trader, apps/mcp-server, apps/agent-runner | AI 売買接点・MCP ツール・自律ループ・意思決定ログ・成績評価・リスクガード |
| `frontend-dev` | apps/web | UI・チャート・状態管理（成績/意思決定ログの可視化含む） |
| `integration-qa` | apps/api, e2e | 結線・E2E・契約テスト監視 |

詳細定義は `.claude/agents/*.md` を参照。並列起動時は `domain-architect` の Phase 0 完了を待ってから他を起動する。

---

## 9. リスクと留意点

- **無料 API の不安定さ**: 規約変更・レート制限・遅延。アダプタ層で吸収し差し替え可能に。商用利用や規約違反に注意（個人・非商用前提）。
- **データ品質**: 分割/配当調整の整合。権威データ（J-Quants）でクロスチェック。
- **金額計算の精度**: 浮動小数禁止。Decimal/整数最小単位で統一。
- **時刻/タイムゾーン**: 市場別取引時間・休場日。すべて UTC 保存＋市場カレンダーで判定。
- **法令**: 投資助言に当たらない表現。免責表示。AI 売買はシミュレーション内に限定し、実発注・実マネーには接続しない。
- **AI エージェントの暴走防止**: 自律ループは RiskGuard（1注文/1日上限・集中度・現金チェック）と enabled フラグ、実行頻度上限で歯止め。全発注に監査ログ必須。
- **AI 取引の LLM コスト**: 自律ループは LLM 呼び出し費用が発生（§2.7 コスト注記）。アプリのローカル・無料制約（§1.3）はインフラに対する制約で、LLM 利用料は別枠。頻度・モデルを設定で抑制。
- **成績評価の公正さ**: ルックアヘッド禁止、約定は実データの気配＋手数料/スリッページ込みで評価。ベンチ（バイ&ホールド/指数）と同条件で比較。

---

## 10. 未決事項（→ すべて決定済み）

1. ~~認証は最小（単一ローカルユーザ）で良いか、将来のマルチユーザを見据えるか。~~ → **決定済み: 個人ユーザーのみ（単一ローカルユーザ。マルチユーザは非対象）。**
2. ~~バックテスト（P2）を初期から設計に織り込むか、後回しか。~~ → **決定済み: 初期から設計に織り込む（契約・データモデルに最初から含める。実装着手は Phase 3）。**
3. ~~信用取引（ショート/レバレッジ）を再現対象に含めるか。~~ → **決定済み: 含める（ロング/ショート・保証金・金利を再現対象に。Phase 3 実装）。**
4. ~~デプロイ前提（完全ローカル / 自宅サーバ / クラウド）。~~ → **決定済み: 完全ローカル・無料運用（§1.3）。**
5. ~~初期入金額・対応通貨（JPY/USD 両建てで良いか）。~~ → **決定済み: JPY/USD 両建て（口座は基軸通貨を持ち、両通貨の現金残高を保持）。**
