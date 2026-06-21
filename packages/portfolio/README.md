# @stonks/portfolio

保有・現金・損益の整合維持と評価（spec §2.3 / §5.1-§5.2 / §6.3）。

## 責務
- `applyTrade(trade)` — Trade を適用してポジション（平均取得単価・一部/全決済の実現損益）、
  通貨別現金残高、CashLedger を整合更新する。
- `getPositions(accountId)` — PriceProvider の時価で評価額・含み損益・含み損益率を載せた `PositionView[]`。
- `getSummary(accountId)` — FxProvider(USD/JPY) で基軸通貨へ換算した現金・評価額・総資産・実現/含み損益。
- `getHistory(accountId, range)` — 約定ごとに記録したエクイティ点（`EquityPoint[]`）。
- `deposit(accountId, money, at?)` / `withdraw(accountId, money, at?)` — 入出金（DEPOSIT/WITHDRAW 台帳。B4）。
  出金は残高不足を `DomainError("INSUFFICIENT_FUNDS")` で拒否。
- `getTrades(accountId)` — 取引履歴（applyTrade で記録。spec §6.8 / B2）。
- `getRealizedPnl(accountId)` — 実現損益（trade 単位。B2）。
- `getTaxLots(accountId, openOnly?)` — 税ロット一覧（取得日昇順。`openOnly` で残数量 > 0 のみ。spec §2.3 P2 / §5.1）。
- `estimateCapitalGainsTax(accountId, range)` — 譲渡益課税の**概算**（spec §2.3 P1 / Phase 3）。
  対象期間（`range.from`〜`range.to`、UTC、`closedAt` で両端含めて絞る）の `RealizedPnl` を**通貨別**に合算し、
  各通貨の実現益から概算税額を算出して `CapitalGainsTaxEstimate[]`（通貨ごとに 1 件）で返す。
  - **益のみ課税**: 損失通貨は税額 0（損益通算・繰越控除・各種特例は行わない簡略方針）。
  - **通貨別**: 基軸換算せず通貨ごとに算出（対象期間に実現損益が無い通貨は結果に含めない）。
  - **率は差し替え可能**: `PortfolioServiceDeps.capitalGainsTaxRate`（省略時 `DEFAULT_CAPITAL_GAINS_TAX_RATE` = 20.315%）。
    NISA 等の非課税は率 `"0"` で表現（口座区分の判定は呼び出し側の責務）。税額計算は core-domain の純関数
    `estimateCapitalGainsTax` に委譲し、自前で率計算しない。
  - **免責**: これは確定申告の正確計算ではなく**シミュレーション上の概算**（CLAUDE.md §7。投資助言ではない）。
    概算税の現金台帳（TAX）への反映は本サービスでは行わない（反映タイミング等は portfolio/api の判断）。
- `RepositoryAccountStateProvider` — contracts `AccountStateProvider`（現金/保有読み取り IF・B2）の実装。
  trading-engine の発注前チェックに注入する。

## 不変条件（テスト済み）
- ポジション数量 = Trade の積み上げ（買い増し / 一部売却 / 全決済）。
- 現金残高 = CashLedger 合計（REALIZED_PNL は損益記録のみで現金移動には数えない）。
- 平均取得単価は手数料込みの加重平均。売却では建値は不変。
- 実現損益 = 売却代金 − 平均建値×数量 − 手数料。
- 金額は浮動小数を使わず `@stonks/core-domain` の Money 演算経由。通貨混在は換算（FxProvider）でのみ解消。
- 現物の売り越し（保有数量超の売却）を拒否。

## 入出力
- 入力: `Trade`（trading-engine 由来）と評価用の価格/為替（PriceProvider / FxProvider IF 経由）。
- 出力: `PositionView` / `PortfolioSummary` / `EquityPoint` / `Trade` / `RealizedPnl` / `TaxLot` /
  `CapitalGainsTaxEstimate`（contracts のスキーマに準拠）。
  `Position` は `currency` を自己記述的に持つ（B3。内部 instrument→currency マップは撤去済み）。

## 依存方向（CLAUDE.md §0 / §4.3）
- `@stonks/contracts`（型・IF）と `@stonks/core-domain`（Money 演算）にのみ依存。
- 価格/為替は **PriceProvider / FxProvider IF 経由のみ**。`@stonks/market-data` を直接 import しない。
- 永続化は内部の `PortfolioRepository` IF に対して行い、`@stonks/db` を直接 import しない。
  Phase 1 は `InMemoryPortfolioRepository`、実 DB 結線は Phase 2 で `PortfolioRepository` を実装して DI 差し替え。

## 使い方
```ts
import {
  DefaultPortfolioService,
  InMemoryPortfolioRepository,
} from "@stonks/portfolio";

const svc = new DefaultPortfolioService({
  repository: new InMemoryPortfolioRepository(),
  priceProvider, // PriceProvider 実装（market-data 由来など）
  fxProvider, // FxProvider 実装
  baseCurrency: "JPY",
  // 任意: 譲渡益課税の概算率を差し替え（省略時 DEFAULT_CAPITAL_GAINS_TAX_RATE=20.315%）。
  // NISA 等の非課税は "0"、US 口座など別率も指定可。
  // capitalGainsTaxRate: "0.20315",
});
```

## コマンド
```
corepack pnpm@9.12.0 --filter @stonks/portfolio typecheck
corepack pnpm@9.12.0 --filter @stonks/portfolio test
```
