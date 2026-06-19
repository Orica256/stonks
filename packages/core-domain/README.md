# @stonks/core-domain

純粋ドメインロジック（値演算・ルール）。**DB/ネットワーク非依存**。各ドメインパッケージが依存する基盤（CLAUDE.md §0）。

## 提供物
- `Money.*` — 金額演算（add/sub/mul/compare/notional 等）。内部 decimal.js、外部表現は `Money` スキーマ。通貨混在演算は実行時に拒否（換算は FX 層）。
- `tickSizeFor` / `roundToTick` / `isValidLot` — 呼値刻みと単元株のルール。
- `isMarketOpen` — 市場別レギュラーセッション/曜日の判定（UTC 基準。祝日は Phase 1 で注入拡張）。

## 入出力
- 入力: `@stonks/contracts` の型（Money/Instrument 等）と素の値。
- 出力: 計算結果（純粋関数、副作用なし）。

## コマンド
```
pnpm --filter @stonks/core-domain test
pnpm --filter @stonks/core-domain typecheck
```
