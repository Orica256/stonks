# @stonks/analytics

テクニカル指標計算（spec §2.4, §6.4）。`IndicatorService` の**純粋関数**実装。
**DB/ネットワーク非依存**・副作用なし。価格は入力として受け取る（CLAUDE.md §0 横依存禁止）。

## 提供物
- `indicatorService` / `createIndicatorService()` — contracts の `IndicatorService` 実装。
  `compute({ bars, indicators })` で OHLCV を指標系列に変換する。
- 個別関数 `sma` / `ema` / `rsi` / `macd` / `bbands`（数値配列 → `(number | null)[]`）。

## 対応指標と params（既定値）
| kind | params（既定） | 出力系列名 |
|---|---|---|
| `SMA` | `period`(20) | `SMA(p)` |
| `EMA` | `period`(20) | `EMA(p)` |
| `RSI` | `period`(14)、Wilder 平滑化 | `RSI(p)` |
| `MACD` | `fast`(12) `slow`(26) `signal`(9) | `MACD(f,s,sig).macd` / `.signal` / `.histogram` |
| `BBANDS` | `period`(20) `stdDev`(2)、母標準偏差 | `BBANDS(p,sd).upper` / `.middle` / `.lower` |
| `VOLUME` | なし | `VOLUME`（出来高をそのまま） |

## 入出力
- 入力: `PriceBar[]`（**時系列昇順前提**。close 等は Decimal 文字列）＋ `IndicatorSpec[]`。
- 出力: `IndicatorResult { ts, series[] }`。
  - `ts` は入力バーの ts 列。各 `series.values` は `ts` と**同じ長さ**。
  - 計算不能な先頭ウォームアップ区間は `null`。
- 指標値は表示・チャート用の派生値であり、契約に従い `number` で返す（金額演算ではない）。

## コマンド
```
corepack pnpm@9.12.0 --filter @stonks/analytics typecheck
corepack pnpm@9.12.0 --filter @stonks/analytics test
```
