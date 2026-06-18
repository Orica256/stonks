# @stonks/market-data

株価・銘柄プロバイダ抽象とアダプタ群（spec §3.1 / §6.1）。複数の**無料** API を
アダプタ層に閉じ込め、**フォールバックチェーン・レート制御・キャッシュ・正規化**を
経て contracts の公開契約を満たす。外部 API 呼び出しはこのパッケージの内側にのみ存在する
（CLAUDE.md §4）。

## 提供する契約（contracts）

- `MarketDataProvider` — `searchInstruments` / `getQuote` / `getBars`
- `PriceProvider` — `getLatestPrice(instrumentId, at?)`（他モジュールが価格を得る最小 IF）
- `FxProvider` — `getRate("USD", "JPY", at?)`

`MarketDataRegistry` がこの 3 契約を一体で実装する。他モジュールは market-data を
直接 import せず、これらの IF 経由で価格を得る（依存性逆転・spec §4.3）。

## アダプタ（spec §3.1 の役割分担）

| アダプタ | 対象 | キー | 役割 / 無料枠の注意 |
|---|---|---|---|
| `FinnhubAdapter` | US | `FINNHUB_API_KEY` | 準リアルタイム気配。無料枠 60 req/min。JP は対象外（`supports` で false） |
| `JQuantsAdapter` | JP | `JQUANTS_REFRESH_TOKEN` | 権威データ・**EOD（日足）のみ**・配信遅延あり。refreshToken→idToken をキャッシュ |
| `YahooAdapter` | 日米 | 不要 | 履歴・JP 価格・**最終フォールバック**。非公式 API のため自主規制で軽くスロットル |
| `ExchangeRateAdapter` | FX | 不要（`FX_API_BASE` で base 上書き可） | USD/JPY。最新値を TTL キャッシュ |

フォールバック優先順（`createMarketDataProvider`）: **Finnhub → J-Quants → Yahoo**。
キー未設定のアダプタは自動スキップされ、Yahoo だけでも最低限機能する。

## 銘柄コードの正準形式

`Instrument.id` は market-data 層で `EXCHANGE:SYMBOL`（例 `TSE:7203` / `NASDAQ:AAPL`）を
正準とする。各アダプタがプロバイダ固有コード（Yahoo `7203.T`、J-Quants `7203` 等）へ変換する。
通貨・市場・タイムスタンプ（UTC ISO8601）・欠損バーの除外もアダプタ層で正規化する。
金額は浮動小数を避け、contracts の `DecimalString`（指数表記なし）に統一する。

## 使い方

```ts
import { createMarketDataProvider } from "@stonks/market-data";

const md = createMarketDataProvider(); // process.env からアダプタを構成
const quote = await md.getQuote("NASDAQ:AAPL");
const bars = await md.getBars({
  instrumentId: "TSE:7203",
  timeframe: "1d",
  from: "2024-01-01T00:00:00.000Z",
  to: "2024-01-31T00:00:00.000Z",
});
const price = await md.getLatestPrice("NASDAQ:AAPL"); // Money
const fx = await md.getRate("USD", "JPY");            // FxRate
```

個別アダプタやインフラ部品（`RateLimiter` / `TtlCache`）も export しており、
ingestion-worker からの取込・バックフィルで再利用できる。

## 設計上のポイント

- **fetch は DI**（`FetchFn`）。既定は Node 標準 `fetch`（新規 HTTP 依存は追加しない）。
  テストはモック fetch でアダプタ正規化・フォールバック・レート制御を検証する（実ネット不使用）。
- **レート制御**: トークンバケット（`RateLimiter`）。無料枠を尊重し外部呼び出し前に待機。
- **キャッシュ**: 気配は短 TTL、為替は 10 分 TTL（`TtlCache`）で無料枠を節約。
- **エラー正規化**: 429→`RATE_LIMITED`、その他障害→`PROVIDER_UNAVAILABLE`（contracts の `DomainError`）。
  これによりレジストリは一様にフォールバック判定できる。

## 環境変数（`.env`。`.env.example` 参照）

```
FINNHUB_API_KEY        # 未設定なら Finnhub はスキップ
JQUANTS_REFRESH_TOKEN  # 未設定なら J-Quants はスキップ
FX_API_BASE            # 既定 https://api.exchangerate.host
```

## コマンド

```
corepack pnpm@9.12.0 --filter @stonks/market-data typecheck
corepack pnpm@9.12.0 --filter @stonks/market-data test
corepack pnpm@9.12.0 --filter @stonks/market-data lint
```

## スコープ外 / 今後

- 永続化（OHLCV → TimescaleDB hypertable）と取込ジョブのスケジューリングは
  `apps/ingestion-worker`（BullMQ）の責務。本パッケージは取得・正規化に集中する。
- 分割/配当調整（`CorporateAction`）は contracts に型があるが取得は未実装（Phase 1 で追補）。
- `streamQuotes`（任意 IF）は無料枠の都合により未実装。
