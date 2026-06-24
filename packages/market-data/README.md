# @stonks/market-data

株価・銘柄プロバイダ抽象とアダプタ群（spec §3.1 / §6.1）。複数の**無料** API を
アダプタ層に閉じ込め、**フォールバックチェーン・レート制御・キャッシュ・正規化**を
経て contracts の公開契約を満たす。外部 API 呼び出しはこのパッケージの内側にのみ存在する
（CLAUDE.md §4）。

## 提供する契約（contracts）

- `MarketDataProvider` — `searchInstruments` / `getQuote` / `getBars` / `getCorporateActions`
- `PriceProvider` — `getLatestPrice(instrumentId, at?)`（他モジュールが価格を得る最小 IF）
- `FxProvider` — `getRate("USD", "JPY", at?)`

`MarketDataRegistry` がこの 3 契約を一体で実装する。他モジュールは market-data を
直接 import せず、これらの IF 経由で価格を得る（依存性逆転・spec §4.3）。

## アダプタ（spec §3.1 の役割分担）

| アダプタ | 対象 | キー | 役割 / 無料枠の注意 |
|---|---|---|---|
| `FinnhubAdapter` | US | `FINNHUB_API_KEY` | 準リアルタイム気配。無料枠 60 req/min。JP は対象外（`supports` で false） |
| `JQuantsAdapter` | JP | `JQUANTS_REFRESH_TOKEN` | 権威データ・**EOD（日足）のみ**・配信遅延あり。refreshToken→idToken をキャッシュ。分割は `daily_quotes` の `AdjustmentFactor` から `getCorporateActions`（SPLIT）を導出 |
| `YahooAdapter` | 日米 | 不要 | 履歴・JP 価格・**最終フォールバック**。非公式 API のため自主規制で軽くスロットル。`getCorporateActions`（DIVIDEND/SPLIT）を `events=div\|split` で取得 |
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
const actions = await md.getCorporateActions({       // CorporateAction[]
  instrumentId: "NASDAQ:AAPL",
  from: "2024-01-01T00:00:00.000Z",
  to: "2024-12-31T00:00:00.000Z",
}); // exDate が [from,to] のものを返す（DIVIDEND/SPLIT）
```

### 配当/分割（`getCorporateActions`、spec §2.1 P1 / §6.1）

`exDate` が `[from, to]`（UTC）に入る `CorporateAction` を返す。getBars と同じ
フォールバックチェーンに乗り、`getCorporateActions` を実装するアダプタのみが候補となる
（**J-Quants 優先 → Yahoo フォールバック**）。レジストリは取得結果の `exDate` を
`from`〜`to` で再フィルタしてから返す。

- **J-Quants（JP 権威・無料枠）**: `daily_quotes` の `AdjustmentFactor`（係数 `!= 1` の日が
  分割の権利落ち日。比率 = `1 / AdjustmentFactor`）から **SPLIT** を導出する。配当は無料枠の
  対象外（`/fins/dividend` は上位プラン）のため J-Quants では返さず Yahoo にフォールバックする。
- **Yahoo（キー不要・日米）**: chart の `events=div|split` から **DIVIDEND**（配当額）と
  **SPLIT**（`numerator/denominator` または `splitRatio` "n:m" → 新株/旧株比率）を取得する。

分割比率は `new shares / old shares`（例 4:1 フォワード=`"4"`、1:10 併合=`"0.1"`）。
比率算出は float 除算を経由せず Decimal 上で計算し DecimalString に正規化する。

個別アダプタやインフラ部品（`RateLimiter` / `TtlCache`）も export しており、
ingestion-worker からの取込・バックフィルで再利用できる。

### 信用建て可否（`marginTradable` / `shortMarginable`、spec §2.2 / §5.1）

`Instrument` の `marginTradable`（信用買建の制度上可否）と `shortMarginable`
（信用売建＝空売り/貸借の制度上可否）を、アダプタが Instrument を組み立てる際に埋める。
無料 API は銘柄ごとの貸借区分を提供しないため**捏造はせず**、「明示的なルール＋設定で
上書き可能なマップ」で妥当な既定を与える（純関数 `resolveMarginEligibility`）。
解決は**フラグ単位**で次の先勝ち優先順:

1. **override マップ**の明示指定（instrumentId 単位・フラグ単位で最優先）
2. **ルールベース既定**:
   - 主要取引所（TSE/NYSE/NASDAQ）上場の STOCK/ETF は `marginTradable=true`
   - 空売り `shortMarginable` は US 株/ETF=`true`、**JP は貸借銘柄に限られ個別判定不能のため
     安全側で `undefined`（不明＝抑止しない）**。貸借銘柄は override で個別に true/false 指定
3. どちらでも決まらなければ `undefined`（不明）。`false`（=制度上不可）と `undefined`（=不明）は
   明確に区別し、判断不能なら `false` を勝手に入れない。

これは銘柄マスタ由来の確定情報ではなく、シミュレーションとして妥当な既定ルールである。

## 設計上のポイント

- **fetch は DI**（`FetchFn`）。既定は Node 標準 `fetch`（新規 HTTP 依存は追加しない）。
  テストはモック fetch でアダプタ正規化・フォールバック・レート制御を検証する（実ネット不使用）。
- **レート制御**: トークンバケット（`RateLimiter`）。無料枠を尊重し外部呼び出し前に待機。
- **キャッシュ**: 気配は短 TTL、為替は 10 分 TTL（`TtlCache`）で無料枠を節約。
- **エラー正規化**: 429→`RATE_LIMITED`、その他障害→`PROVIDER_UNAVAILABLE`（contracts の `DomainError`）。
  これによりレジストリは一様にフォールバック判定できる。

## 環境変数（`.env`。`.env.example` 参照）

```
FINNHUB_API_KEY            # 未設定なら Finnhub はスキップ
JQUANTS_REFRESH_TOKEN      # 未設定なら J-Quants はスキップ
FX_API_BASE                # 既定 https://api.exchangerate.host
MARGIN_TRADABLE_OVERRIDES  # 信用買建可否の上書き（カンマ区切り）
SHORT_MARGINABLE_OVERRIDES # 信用売建(空売り)可否の上書き（カンマ区切り）
```

`*_OVERRIDES` の各トークンは `EXCHANGE:SYMBOL[:FLAG]` 形式。`FLAG` は
`+`/`true`/`1`/`yes`=true、`-`/`false`/`0`/`no`=false、省略時は true（許可リスト運用）。
instrumentId 自体が `:` を含むため、コロンが 2 つ以上ある場合のみ末尾を FLAG とみなす。
例: `MARGIN_TRADABLE_OVERRIDES="TSE:9984,TSE:1234:false"` /
`SHORT_MARGINABLE_OVERRIDES="TSE:7203:true,TSE:1234:false"`。

## コマンド

```
corepack pnpm@9.12.0 --filter @stonks/market-data typecheck
corepack pnpm@9.12.0 --filter @stonks/market-data test
corepack pnpm@9.12.0 --filter @stonks/market-data lint
```

## スコープ外 / 今後

- 永続化（OHLCV → TimescaleDB hypertable）と取込ジョブのスケジューリングは
  `apps/ingestion-worker`（BullMQ）の責務。本パッケージは取得・正規化に集中する。
- 分割/配当（`CorporateAction`）の取得は `getCorporateActions` で実装済み（J-Quants=SPLIT /
  Yahoo=DIVIDEND+SPLIT、いずれも無料枠）。配当の JP 権威データ（`/fins/dividend`）は上位プランの
  ため取り込まず、当面 Yahoo にフォールバックする。
- `streamQuotes`（任意 IF）は無料枠の都合により未実装。
