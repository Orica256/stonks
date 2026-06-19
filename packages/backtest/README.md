# @stonks/backtest

ヒストリカル OHLCV に対してルールベース戦略を**仮想時間**で実行し、成績指標と
エクイティカーブを返すバックテストエンジン（spec §2.5 / §6.5、Phase 3）。

## 責務

- 公開契約 `BacktestRunner` / `StrategyDef` / `BacktestResult`（`@stonks/contracts`）に準拠。
- 約定は **trading-engine**（`StandardTradingEngine` / `StandardFeeModel` / `SlippageFillModel`）を
  再利用し重複実装しない。指標・シグナル評価は **analytics**（`sma` 等）を再利用。
- 過去バーを ts 昇順で順次供給し、各バーは**その時点までの close 列のみ**で判断する
  （ルックアヘッド禁止）。価格は `HistoricalPriceFeed`（`PriceProvider` 実装）経由で供給。
- 金額は浮動小数を使わず `@stonks/core-domain` の Money / Decimal 経由。時刻は UTC。

## 入出力

- 入力: `RunBacktestRequest { strategy: StrategyDef, range: DateRange, initialCash: DecimalString }`
  ＋ コンストラクタに `BacktestDataSource`（ヒストリカル Instrument / PriceBar の供給元）。
- 出力: `BacktestResult { metrics, equityCurve }`。
  - `metrics.totalReturn`: 最終 equity / 初期 equity − 1（比率）。
  - `metrics.maxDrawdown`: エクイティのピークからの最大下落率（正の比率）。
  - `metrics.sharpe`: バーごと単純リターン系列の 平均 / 標準偏差（無リスク 0・年率化なし）。
  - `metrics.winRate`: 決済（SELL/CLOSE）トレードの勝率（0..1）。
  - `metrics.trades`: 決済トレード数。
  - `equityCurve`: `{ ts, equity }` の配列（各バー終値時点の現金 + 保有時価）。

## 戦略ルール（`StrategyRule.when` の式）

`rule-evaluator` がサポートする最小式（大文字小文字無視）:

- `SMA(n) crossUp SMA(m)` / `SMA(n) crossDown SMA(m)`
- `price > N` / `price < N` / `price >= N` / `price <= N`
- `always`

`sizing.mode` は `FIXED_QTY`（固定株数）/ `EQUITY_PCT`（現金または保有評価に対する比率）。
`action` は `BUY` / `SELL` / `CLOSE`。発注はすべて MARKET（DAY）。

## 使い方

```ts
import { HistoricalBacktestRunner, InMemoryDataSource } from "@stonks/backtest";

const data = new InMemoryDataSource([instrument], { "i-1": bars });
const runner = new HistoricalBacktestRunner(data);
const result = await runner.run({ strategy, range, initialCash: "1000000" });
```

## 実行手順

```
pnpm --filter @stonks/backtest typecheck
pnpm --filter @stonks/backtest lint
pnpm --filter @stonks/backtest test
```

## 既知の縮退・制約

- universe は単一通貨を前提（混在は範囲外。FX 換算は別層の責務）。
- MARKET BUY は trading-engine の事前現金チェックを行わないため、ランナー側で残現金を追跡するが
  予算超過の発注を厳密に弾かない（過去データ再生時の縮退）。今後 RiskGuard 連携で強化予定。
