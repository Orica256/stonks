# 契約バックログ（共有事項）

> Phase 1・Phase 2 の並列実装で各モジュール担当が見つけた **`packages/contracts` の不足・不整合・要検討事項**を集約したもの。
> 実装側は勝手に契約を変えず（CLAUDE.md §0）、ここに申し送り、`domain-architect` が調停して反映する。
> ステータス: **未対応（次に着手すべき設計タスク）**

## Phase 3 契約: 信用取引（margin）・税ロット（tax lot）✅ 反映済み

> spec §2.2 P2（信用取引）・§2.3 P2（税ロット）・§5.1（Position 信用拡張 / TaxLot）の
> 契約・データモデルを `domain-architect` が確定。後続の trading-engine（margin 約定/金利）・
> portfolio（tax lot 管理）の並列実装の前提。**すべて追加的・後方互換**（既存の現物フロー /
> Phase 2 の全テストを壊さない）。

### 追加した型/スキーマ（`packages/contracts`）
- `margin.ts`:
  - `MarginType`(CASH|MARGIN)、`Rate`（0 以上の小数文字列。浮動小数禁止）。
  - `MarginPolicy`（initial/maintenance margin rate・annual interest/borrow rate）。
  - `MarginRequirement`（発注前の必要保証金: notional / requiredMargin / rate）。
  - `MarginInfo`（建玉の保証金/金利情報。Position.margin に載る）。
  - `InterestAccrual` / `InterestAccrualType`(INTEREST|BORROW_FEE)（金利/貸株料の発生記録）。
  - `MarginCallStatus`（追証=margin call 判定結果）。
- `tax-lot.ts`:
  - `TaxLot`（id, accountId, instrumentId, quantity, **remainingQuantity**, costBasis,
    currency, acquiredAt, **method**, **taxAccountType**, acquiredTradeId?）。
  - `CostBasisMethod`(AVERAGE|FIFO|LIFO|SPECIFIC_LOT)、`TaxAccountType`(SPECIFIC|GENERAL|NISA)。
  - `TaxLotConsumption`（売却で取り崩したロット内訳 1 行）。
  - `RealizedPnlWithLots`（RealizedPnl + 取り崩し内訳 `lots` + `method`。どのロットを取り崩したかを明示）。
- 既存スキーマの拡張（**後方互換**）:
  - `Order` / `Trade` / `Position` に `marginType: MarginType.optional()`（未指定=現物。
    永続層は Prisma `@default(CASH)`）。`Order`/`Trade`/`Position` は **optional**（`.default` にすると
    `z.infer` の出力型が必須化し、手書きで record を組む既存コード〔engine/portfolio/fakes〕が壊れるため）。
  - `PlaceOrderCommand` に `marginType?`（現物コマンドは省略で従来通り）。
  - `Position` に `margin?: MarginInfo`（MARGIN 建玉のみ）。
  - `ledger.ts` `LedgerEntryType` に `INTEREST` / `BORROW_FEE` を追加。

### 追加した IF（最小限）
- `PortfolioService.getTaxLots?(accountId, openOnly?)`（**optional メソッド**。既存実装/フェイクを
  壊さないため任意。portfolio の税ロット実装タスクで実装する。必須化は実装後に検討）。
- `MarginPolicyProvider`（`trading-engine.ts`）: `getMarginPolicy(instrumentId): Promise<MarginPolicy|null>`。
  信用不可銘柄は null（その場合 MARGIN 発注は拒否）。規定値の出所は実装側。

### DB（`packages/db`）
- 新 enum: `MarginType` / `CostBasisMethod` / `TaxAccountType` / `InterestAccrualType`、
  `LedgerEntryType` に `INTEREST`/`BORROW_FEE` 追加。
- `Order.marginType` / `Trade.marginType` を `@default(CASH)` で追加。
- `Position` に信用列を追加（`marginType @default(CASH)`, `postedMargin?`, `initialMarginRate?`,
  `maintenanceMarginRate?`, `annualRate?`, `accruedInterest @default(0)`, `lastAccruedAt?`）。
- 新テーブル `TaxLot` / `InterestAccrual`（Account/Instrument への FK・索引付き）。
- 手書き SQL マイグレーション: `prisma/migrations/20260620_phase3_margin_tax/migration.sql`
  （live DB が無い環境のため生 SQL。すべて DEFAULT 付き ADD COLUMN / CREATE TABLE で後方互換）。

### 後続実装担当への申し送り
- **trading-engine（margin 約定/金利）**:
  - `PlaceOrderCommand.marginType === "MARGIN"` のとき信用建てとして処理。`undefined`/`"CASH"` は現物。
  - `MarginPolicyProvider.getMarginPolicy(instrumentId)` で必要保証金率・金利を解決（null=信用不可→拒否）。
  - 発注前チェックは `MarginRequirement`（notional = quantity × price、requiredMargin = notional ×
    initialMarginRate）を組み、`AccountStateProvider` の現金/保証金余力と突き合わせる。不足は
    `DomainError("INSUFFICIENT_FUNDS")`。
  - 約定で生成する `Trade` に建玉と同じ `marginType` を載せる（portfolio が CASH/MARGIN を振り分ける）。
  - 金利は `InterestAccrual`（amount = principal × annualRate × days / 365、費用=負）を日次計上し、
    `CashLedgerEntry(INTEREST|BORROW_FEE)` として現金へ反映。建玉側 `Position.margin.accruedInterest` /
    `lastAccruedAt` を更新（アキュムレートのステート管理は実装側）。
- **portfolio（tax lot 管理）**:
  - `applyTrade` で買い（取得）ごとに `TaxLot` を 1 件起こし、売り（クローズ）で `method`
    （既定 AVERAGE）に従い `remainingQuantity` を取り崩す。取り崩し内訳を `TaxLotConsumption[]` に残し、
    `RealizedPnlWithLots` を算出（既存 `RealizedPnl` は据え置きで両立。詳細が要る箇所で後者を使う）。
  - `PortfolioService.getTaxLots` を実装（取得日昇順、`openOnly` で残数量 > 0 のみ）。実装後、optional を
    必須メソッドへ昇格するか domain-architect と調整。
  - MARGIN 建玉は `Position.marginType="MARGIN"` + `Position.margin`(MarginInfo) を設定。
- **未決事項 / 要調整**:
  - `Position` の一意キーは後方互換で `[accountId, instrumentId, side]` のまま据え置いた
    （apps/api の upsert キー `accountId_instrumentId_side` を壊さないため）。同一 (account, instrument, side)
    で **CASH と MARGIN の LONG 建玉を別行**にしたくなった場合は、`[..., marginType]` への一意キー変更を
    **apps/api 担当と調整**して行う（repository の where 句修正が必要）。当面は side（LONG/SHORT）で大半が分離される。
  - 税の `method` の既定を AVERAGE としたが、JP 現物の標準は「総平均/移動平均」。FIFO/LIFO/SPECIFIC_LOT の
    選択 UI/設定をどこで持つか（口座属性か発注時指定か）は portfolio/api 実装時に詰める。
  - 譲渡益課税の概算（spec §2.3 P1 の税計算）と税ロットの接続（`RealizedPnlWithLots` → `CashLedgerEntry(TAX)`）は
    portfolio 実装の範囲で詰める。spec とは矛盾なし（spec §5.1 の TaxLot 定義に `remainingQuantity` を
    実務上追加したのみ。spec 側の TaxLot 行に残数量の含意を補記する余地あり＝**spec 更新提案候補**）。

## Phase 3 契約: 譲渡益課税の概算（capital gains tax estimate）✅ 反映済み

> spec §2.3 P1「税計算（譲渡益課税の概算）」の契約を `domain-architect` が確定。
> **概算**（確定申告の正確計算ではない。CLAUDE.md §7 免責の範囲）であることを型・命名・
> ドキュメントで明示。後続の portfolio（実現益からの税概算集計）実装の前提。
> **すべて追加的・後方互換**（既存の現物/Phase 2 の全テストを壊さない。新フィールド/メソッドは
> optional/default のみ）。

### 追加した型/定数/IF
- `packages/contracts/tax.ts`（新規）:
  - `DEFAULT_CAPITAL_GAINS_TAX_RATE = "0.20315"`（= 所得税15% + 復興特別所得税0.315% + 住民税5%。
    日本株の申告分離課税の既定概算率。`Rate`=DecimalString として持つ。**口座区分/通貨で差し替え可**）。
  - `CapitalGainsTaxEstimate`(Zod): `{ accountId, range(DateRange), currency(Currency),
    realizedGains: DecimalString, taxRate: Rate, estimatedTax: DecimalString }`。
    通貨別に 1 件返す想定。`estimatedTax = max(realizedGains, 0) × taxRate`（常に 0 以上）。
    **損失は通算せず税額 0**（益のみ課税対象とみなす簡略方針）。型 JSDoc に簡略点を明記。
- `packages/core-domain/tax.ts`（新規）:
  - `estimateCapitalGainsTax(realizedGains, taxRate?=DEFAULT...)`: decimal.js で概算税額を算出する
    純関数（浮動小数禁止）。損失は 0。`DEFAULT_CAPITAL_GAINS_TAX_RATE` を再エクスポート。
- IF（最小・後方互換）:
  - `PortfolioService.estimateCapitalGainsTax?(accountId, range): Promise<CapitalGainsTaxEstimate[]>`
    （**optional メソッド**。既存実装/フェイクを壊さないため任意。portfolio 実装後に必須化を検討）。

### DB（`packages/db`）
- **変更なし**（新テーブル不要）。概算は既存 `RealizedPnl` から計算で導出する。税率を口座属性として
  永続化する要件は現状なし（既定率＋設定差し替えで足りる）。将来 NISA 等を口座単位で精密に持つ必要が
  出たら、`Account` に最小列を足すか別途検討（過剰設計しない）。

### 後続実装担当への申し送り（portfolio）
- `estimateCapitalGainsTax(accountId, range)` を実装する:
  - `getRealizedPnl(accountId)` の結果を `range`（from/to。UTC、`closedAt` で絞る）で抽出し、
    **通貨ごと**に `realized` を合算 → 通貨別 `realizedGains` を得る。
  - 税額は core-domain の `estimateCapitalGainsTax(realizedGains, rate)` を使う（自前で率計算しない）。
    既定率は `DEFAULT_CAPITAL_GAINS_TAX_RATE`。設定で率を差し替えられる導線を用意（口座属性 or 設定値）。
  - 通貨別に `CapitalGainsTaxEstimate` を組んで配列で返す（対象期間に実現益がない通貨は省略 or
    realizedGains="0"/estimatedTax="0" で返すかは実装方針として一貫させる）。
  - **損益通算は概算では行わない**（損失通貨は税額 0）。複数銘柄/期間の通算・繰越控除は概算スコープ外。
  - 税ロット（`RealizedPnlWithLots`）との接続（method 別の取得費算定）を使うかは任意。概算は
    `RealizedPnl.realized` の符号で十分（method の精密さは概算には不要）。
  - 概算税を実際に現金へ反映する場合は `CashLedgerEntry(TAX)` を起こす（反映タイミング=確定/期末などは
    portfolio/api で決める。本契約は「概算の表示・取得」までで、課税の現金反映は強制しない）。
- 実装後、optional を必須メソッドへ昇格するか domain-architect と調整。

### spec 更新提案
- spec §10（未決事項）に **税の確定方針が無い**。本タスクで以下を既定として導入したので spec へ追記提案:
  「譲渡益課税は **概算**（実現益×概算率）で表示する。既定率は **20.315%**（所得税15%+復興0.315%+住民5%）
  とし、**設定で差し替え可能**。損益通算・繰越控除・各特例は概算では行わない（益のみ課税対象の簡略）。
  確定申告の正確計算はスコープ外（CLAUDE.md §7 免責）。」 spec §2.3 P1 の文言とは矛盾なし（補強のみ）。

## 優先度高（複数モジュールが回避策で凌いでいる＝早く正式化したい）

### B1. 銘柄 ID 体系の正準化 `EXCHANGE:SYMBOL` ✅ 対応済み
- market-data は銘柄を `EXCHANGE:SYMBOL`（例 `TSE:7203`, `NASDAQ:AAPL`）で識別・通貨導出している。
- 一方 `db` の `Instrument.id` は `cuid()` 既定。apps/api は突き合わせのため **`Instrument.id` に `EXCHANGE:SYMBOL` を格納**する前提で結線（cuid 不使用）。
- → 対応済み: contracts に `InstrumentId`（`^(TSE|NYSE|NASDAQ):…$` の Zod スキーマ）＋ `buildInstrumentId`/`parseInstrumentId` helper を追加し、`Instrument.id` の正準形式として正式採用。db の `Instrument.id` は cuid 既定を外し正準キーをそのまま格納。market-data の symbols.ts は contracts の helper に委譲し二重定義を解消（参照系の instrumentId フィールドは既存フィクスチャ互換のため `Id` のまま）。

### B2. 読み取り系インターフェースが contracts に無い ✅ 対応済み
複数モジュールが内部ポートを発明して凌いでいる。contracts に正式な読み取り IF を定義したい:
- **現金/保有の読み取り**: trading-engine が `AccountStateProvider`（内部）で発注前チェック。apps/api が portfolio へブリッジ。
- **取引履歴の一覧**: `PortfolioService` に無く、apps/api が `TradeLog`（内部）を用意。
- **実現損益（trade 単位）一覧**: agent-trader の勝率計算に必要だが無く、エクイティ系列の上昇比率で代理。
- **銘柄解決（symbol/通貨）**: agent-trader の `AgentObservation.positions[].symbol` が取れず `instrumentId` でフォールバック。portfolio も内部に instrument→currency マップを保持。
- → 対応済み: contracts に `AccountStateProvider`・`InstrumentResolver` を正式 IF 化し、`PortfolioService` に `getTrades` / `getRealizedPnl` を追加。trading-engine は内部 `AccountStateProvider`/`InstrumentProvider` を contracts の IF に置換（後者は `InstrumentResolver` 別名）。portfolio は applyTrade で Trade を記録し getTrades で公開、`RepositoryAccountStateProvider` を提供。agent-trader は `InstrumentResolver`（任意注入）で symbol 解決、勝率を `getRealizedPnl` の trade 単位で算出。apps/api は内部 `TradeLog`・`PortfolioAccountStateProvider` ブリッジを削除。

### B3. `Position.currency` フィールド追加 ✅ 対応済み
- `PositionView.marketValue`/`unrealizedPnl` は `Money`（通貨付き）だが、`Position` は `avgCost: DecimalString` のみで通貨を持たない。
- portfolio は内部 instrument→currency マップで回避中。`Position` に `currency: Currency` を持たせれば自己記述的になり回避策が消える。
- → 対応済み: contracts `Position` に `currency: Currency` を追加、db `Position.currency` 列を追加。portfolio は内部 `instrumentCurrency` マップを撤去し、建玉通貨を `Position.currency` から参照（換算・スナップショット）。

### B4. 入出金（deposit/withdraw）の責務 ✅ 対応済み
- `applyTrade` で現金=台帳整合を保つには現金の出所が要る。portfolio は契約外の具象 `deposit()` を追加して凌いでいる。
- → 対応済み: `PortfolioService` に `deposit(accountId, amount, at?)` / `withdraw(accountId, amount, at?)` を IF として明示。portfolio は両者を CashLedger(DEPOSIT/WITHDRAW) と整合更新し、出金は残高不足を `DomainError("INSUFFICIENT_FUNDS")` で拒否。

## 優先度中

### B5. `PlaceOrderCommand` に成行買いの予算上限
- 成行買いは発注時に約定価格が未確定で事前現金チェックができない（現状は約定時に portfolio 側で反映）。
- 任意の `estimatedPrice` か `maxNotional` があると事前チェックを厳密化できる。

### B6. `FillModel.tryFill` がステートレス
- STOP/STOP_LIMIT のトリガ判定は本質的にステートフル（一度発火で維持）。trading-engine は engine 側でトリガ状態を管理して回避。
- backtest と約定ロジックを共有するなら、トリガ判定込みの評価 IF を契約に明示すると再利用しやすい。

### B7. 手数料の表現 `Money` 統一
- `Trade.fee` は `DecimalString` 単体、`FeeModel.calculate` は `{ fee: Money }`。currency は Trade 側にあり整合は取れているが、`Money` に統一する余地。

### B8. `RiskGuard.check` のシグネチャ
- 現在 同期＋`(accountId, action)` のみ。現金/集中度/日次累計の判定に口座状態が要るため、agent-trader は内部 `RiskState` を構築して注入。
- `check(accountId, action, context)` か `Promise` 戻り化を検討すると、状態取得を RiskGuard 内に閉じられる。

### B9. 成績評価の基準点
- `PerformanceSnapshot.cumulativeReturn` は初期エクイティ点が必要。portfolio は約定ごとに EquityPoint を記録するため、入金直後の基準点が無いと基準が最初の約定後になる。入金時点のスナップショットがあると正確。
- `getHistory` のエクイティ意味（mark-to-market か cost basis か）が未定義。現状は cost basis（provider 非依存・決定的）。

## 優先度低（任意・型の締め付け）

### B10. `IndicatorResult.ts` の型
- `z.array(z.string())` で任意文字列。入力 `PriceBar.ts` は `Timestamp` なので `ts: z.array(Timestamp)` に締めても良い（任意）。

### B11. `IndicatorSpec.params` の discriminated union 化
- 現在 `z.record(z.number())` で MACD の fast/slow/signal も同居。kind 別 union 化で型安全性が上がる（現契約でも実装可）。

### B12. `CorporateAction` 取得 IF ✅ 対応済み
- 型はあるが `MarketDataProvider` に取得メソッドが無い（分割/配当の取り込み）。Phase 1 で IF 追加を提案。
- → 対応済み（Phase 4）: `market-data.ts` に `GetCorporateActionsRequest`（`GetBarsRequest` に倣う。`instrumentId`/`from`/`to`、UTC）を追加し、`MarketDataProvider.getCorporateActions?(req): Promise<CorporateAction[]>` を **optional メソッド**として追加。理由: 唯一の具象実装 `MarketDataRegistry` と apps のフェイクが `implements MarketDataProvider` のため、必須化すると両者が壊れる。レジストリはアダプタの method 有無で `candidates` をフィルタするので、対応アダプタのみ提供できる設計と整合（未提供は ingestion 側でスキップ/フォールバック）。対応アダプタが揃ったら必須化を検討。

## Phase 4 契約: 配当/分割の取得・適用 + ベンチ比較不能の契約化 ✅ 反映済み

> spec §2.1 P1（分割調整）/ §2.3 P1（配当受取）/ §2.7 P1（ベンチ比較）と B12 に対応。
> **すべて追加的・後方互換**（optional メソッド/新規型のみ。Phase 2/3 の全テストを壊さない）。

### 追加した型/IF（`packages/contracts`）
- `market-data.ts`:
  - `GetCorporateActionsRequest`（Zod。`instrumentId`/`from`/`to`、UTC）。
  - `MarketDataProvider.getCorporateActions?(req): Promise<CorporateAction[]>`（**optional**。B12 参照）。
- `portfolio.ts`:
  - `PortfolioService.applyCorporateAction?(accountId, action: CorporateAction): Promise<void>`（**optional**）。
    DIVIDEND=保有数量×1株配当を `CashLedger(DIVIDEND)` で現金反映、SPLIT=数量/平均取得単価を比率調整（建玉価値不変）。
    源泉徴収・配当課税・端株の現金処理は概算スコープ外（CLAUDE.md §7 免責）と JSDoc に明記。
    `CorporateAction` は `market-data.js` から type import（契約の二重管理なし）。
- `agent.ts`:
  - `BenchmarkUnavailableReason`（Zod enum `NOT_CONFIGURED|PRICE_DATA_MISSING|NO_STRATEGY_EQUITY`＋型）。
    agent-trader の `performance-evaluator.ts` の同名 string union を契約化したもの（値は完全一致）。
  - `BenchmarkComparisonResult`（discriminated union on `available`）:
    `{ available: true, comparison: BenchmarkComparison } | { available: false, benchmark: BenchmarkId, reason: BenchmarkUnavailableReason }`。
    既存 `BenchmarkComparison`（成立時の数値のみ）は**破壊せず据え置き**、不成立を理由付きで返すラッパとして新設。

### DB（`packages/db`）
- **変更なし**。IF 追加のみで永続スキーマ要件は増えない（`CorporateAction`/`CashLedger(DIVIDEND)` は spec §5.1 既存。
  実際の CorporateAction 永続テーブルが必要になるのは ingestion 実装時で、今回の契約追加だけでは不要＝過剰設計しない）。

### 後続実装担当への申し送り
- **market-data**: `MarketDataRegistry` に `getCorporateActions(req: GetCorporateActionsRequest)` を実装（対応アダプタの
  フォールバックチェーンで取得。`exDate` が `from`〜`to` に入るものに絞る）。アダプタ側に対応メソッドが無ければ
  そのアダプタは候補から外れる（既存 `candidates` のパターン）。対応プロバイダが揃ったら optional の必須化を相談。
- **portfolio**: `applyCorporateAction(accountId, action)` を実装。DIVIDEND は建玉通貨で `qty × value` を現金加算し
  `CashLedgerEntry(DIVIDEND, refId=action)` を起こす。SPLIT は `Position.quantity`/`avgCost` を比率調整（quantity×avgCost 不変）。
  税ロット（`TaxLot`）保有時は SPLIT で各ロットの数量/取得単価も比率調整すること（concern: 端数の丸め方針を一貫させる）。
  概算スコープにつき源泉徴収・配当課税は行わない。実装後 optional の必須化を相談。
- **agent-trader**: `performance-evaluator.ts` のローカル `BenchmarkUnavailableReason` を contracts の同名 enum 型に置換可
  （値は同一。`BenchmarkUnavailableError.reason` の型を contracts 由来にすると api 側と一貫）。`compare` の戻りは
  既存 `BenchmarkComparison`（throw で不成立表現）のままで後方互換。`BenchmarkComparisonResult` を返す薄いラッパ
  （throw→`{available:false, reason}` 変換）を agent-trader か api のどちらに置くかは実装で決める。
- **api / web**: api は `BenchmarkUnavailableError` を握り潰して `comparison: null` にする代わりに、
  `BenchmarkComparisonResult` で `{available:false, benchmark, reason}` を返せる。web は `reason` で
  「未設定/データ欠落/エクイティ不足」を型付きでユーザーに提示（推測リターンを出さない。spec §9 公正性）。

## ツール債務（契約ではないが要対応）

### T1. ESLint 設定の配線が不統一 ✅ 対応済み
- `packages/{portfolio,market-data,agent-trader}` には `eslint.config.js` があるが、`contracts/core-domain/analytics/trading-engine/db` には無く `pnpm -r lint` が一部失敗する（typecheck/test は全 green）。
- → `packages/config` の共有 flat config を各パッケージで継承する `eslint.config.js` を統一配置（または root 集約）。`domain-architect`/config の領域。
- → 対応済み: 5パッケージ（contracts/core-domain/analytics/trading-engine/db）に共有 flat config 継承の `eslint.config.js` を配置。`db` には `"lint": "eslint src"` スクリプトも追加。
