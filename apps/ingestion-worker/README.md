# @stonks/ingestion-worker

価格・銘柄・為替の取込ワーカー（BullMQ consumer）。spec §2.1 / §4.1。

## 責務

- `market-data` の Provider IF（`MarketDataProvider` / `FxProvider`）**経由でのみ**外部データを取得し、`db`（Prisma）へ永続化する。
- 日足 OHLCV のバックフィル、最新気配ポーリング、為替（USD/JPY）取得を**スケジュール実行**する。
- レート制御・フォールバック・正規化は `market-data` のアダプタ層に委譲。ワーカーは **スケジューリングと永続化トリガに徹する**（外部 API を直接叩かない。CLAUDE.md §4）。

依存方向: `ingestion-worker → contracts, core-domain, db, market-data`（横方向のドメイン直 import なし）。

## ジョブ一覧

単一キュー `ingestion` に相乗りし、ジョブ名で種別を判別する。ペイロードは Zod で検証してからハンドラへ渡す。

| ジョブ名 | ハンドラ | 内容 | スケジュール（既定） |
|---|---|---|---|
| `backfill-bars` | `handleBackfillBars` | 指定銘柄の `[from,to]` 日足を `getBars` で取得し upsert（冪等） | 起動時に 1 回だけ enqueue（ブートストラップ） |
| `poll-quote` | `handlePollQuote` | 1 銘柄の最新気配を `getQuote` で取得し保存。休場中は `force=false` でスキップ（市場カレンダー判定） | `*/5 9-23 * * 1-5`（平日 5 分毎） |
| `fetch-fx-rate` | `handleFetchFxRate` | USD/JPY を `getRate` で取得し保存 | `0 * * * *`（毎時） |

- 鮮度の現実解は **US=準リアルタイム（数分遅延）/ JP=EOD＋遅延**（spec §3.1）。`poll-quote` は休場帯で自動スキップし無料枠を節約する。
- `PriceBar` は TimescaleDB hypertable（spec §5.1）。`saveBars` は `(instrumentId, timeframe, ts)` で upsert し再取込で重複しない。

## 環境変数

`.env`（コミット禁止）。キー値はリポジトリに含めない。`.env.example` に項目のみ記載。

| 変数 | 既定 | 説明 |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | BullMQ 接続先 |
| `DATABASE_URL` | — | Prisma 接続先（OHLCV/Quote/FxRate 永続化） |
| `INGEST_CONCURRENCY` | `2` | 同時実行ジョブ数（二重防御。本来のレート制御は market-data 側） |
| `INGEST_SCHEDULE_ENABLED` | `true` | cron 登録の有効/無効（`false` で consumer のみ） |
| `INGEST_POLL_QUOTE_CRON` | `*/5 9-23 * * 1-5` | 気配ポーリング cron |
| `INGEST_DAILY_BARS_CRON` | `0 21 * * *` | （予約）日足取込 cron |
| `INGEST_FX_CRON` | `0 * * * *` | FX 取得 cron |
| `INGEST_UNIVERSE` | 空 | スケジュール対象銘柄（カンマ区切り `EXCHANGE:SYMBOL`） |
| `INGEST_BACKFILL_DAYS` | `365` | ブートストラップ・バックフィルの遡及日数 |

プロバイダ API キー（`FINNHUB_API_KEY` / `JQUANTS_REFRESH_TOKEN` / `FX_API_BASE`）は `market-data` の `createMarketDataProvider(env)` がそのまま受け取る。ワーカーは保持・ログ出力しない。

## 起動

Redis / Postgres はルートの `docker compose up`（`redis`, `db` サービス）で起動する。新規サービス追加は不要。

```sh
corepack pnpm@9.12.0 --filter @stonks/ingestion-worker dev    # tsx watch
corepack pnpm@9.12.0 --filter @stonks/ingestion-worker build  # dist 出力
corepack pnpm@9.12.0 --filter @stonks/ingestion-worker start  # node dist/main.js
```

起動時に `registerSchedules()`（repeatable 登録）→ `enqueueBackfill()`（単発バックフィル）を実行し、consumer を開始する。`SIGINT`/`SIGTERM` で Worker → Queue の順にグレースフルシャットダウンする。

## テスト

実 Redis・実外部 API・実 DB に依存しない。`bullmq` をモックし、`market-data` プロバイダと `db` リポジトリは contracts IF 実装のフェイク（`test-fakes.ts`）に対して検証する。

```sh
corepack pnpm@9.12.0 --filter @stonks/ingestion-worker typecheck
corepack pnpm@9.12.0 --filter @stonks/ingestion-worker test
```
