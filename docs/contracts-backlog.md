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
  - ~~`Position` の一意キーは後方互換で `[accountId, instrumentId, side]` のまま据え置いた~~
    **→ Phase 5 で `[accountId, instrumentId, side, marginType]` へ拡張し解決済み**（上「Phase 5 契約」節参照）。
    apps/api の upsert キーは `accountId_instrumentId_side` → `accountId_instrumentId_side_marginType` へ要修正（次 Wave）。
  - 税の `method` の既定を AVERAGE としたが、JP 現物の標準は「総平均/移動平均」。FIFO/LIFO/SPECIFIC_LOT の
    選択 UI/設定をどこで持つか（口座属性か発注時指定か）は portfolio/api 実装時に詰める。
  - 譲渡益課税の概算（spec §2.3 P1 の税計算）と税ロットの接続（`RealizedPnlWithLots` → `CashLedgerEntry(TAX)`）は
    portfolio 実装の範囲で詰める。spec とは矛盾なし（spec §5.1 の TaxLot 定義に `remainingQuantity` を
    実務上追加したのみ。spec 側の TaxLot 行に残数量の含意を補記する余地あり＝**spec 更新提案候補**）。

## Phase 5 契約: 複合注文(OCO/IFD)・建玉分離（Position 一意キー）✅ 反映済み

> spec §2.2 P2「OCO/IFD などの複合注文」と、本バックログ末尾の未決事項
> 「CASH/MARGIN 同一建玉分離（Position 一意キー変更）」を `domain-architect` が確定。
> **すべて追加的・後方互換**（新 optional フィールド/新 enum/新 optional メソッドのみ。
> Phase 2/3/4 の全テストを壊さない。既存 contracts 30→43 テスト green）。

### 1) 複合注文（OCO / IFD / bracket）

**採用設計**: 「`Order` への optional link フィールド追加」＋「複合発注は別コマンド `PlaceBracketOrderCommand` を新設」のハイブリッド。

- `order-link.ts`（新規）:
  - `OrderLinkType`(OCO|IFD)、`OrderActivation`(ACTIVE|WAITING)。
  - `OrderGroup`（グループ単位の取消/照会/監査用の読み取り表現。`orderIds.min(2)`・`parentOrderId?`）。永続化は任意（現状 DB テーブル化せず Order の列だけでカスケード成立）。
  - `PlaceBracketOrderCommand`（`kind` で discriminated union）:
    - `OCO`: `legs`(2 本) を同時 ACTIVE。片約定で他方 CANCELLED。
    - `IFD`: `parent` 約定で `children`(1 本以上) を WAITING→ACTIVE 発効。
    - `BRACKET`: `parent` 約定で `children`(2 本) 発効し、子同士を OCO で結ぶ（利確＋損切）。
    - leg/parent/child の中身は **`z.unknown()`**（`PlaceOrderCommand` を直接 import すると循環し、また各脚の price 妥当性は trading-engine が `PlaceOrderCommand.safeParse` で個別検証するのが筋のため）。contracts は構造と件数（tuple/min）と意味論のみ固定。
- `order.ts` `Order` に optional 追加（**後方互換**。単発は全て未設定で従来挙動）:
  - `linkGroupId?`（OCO/bracket 子のグループ ID）、`linkType?`(OCO|IFD)、`parentOrderId?`（IFD/bracket 親）、`activation?`(ACTIVE|WAITING)。
  - **設計判断**: `OrderStatus` enum に WAITING を足さず、発効状態を直交軸 `activation` として別フィールドに分離した。理由: 既存の `OPEN_STATUSES=Set("PENDING","PARTIALLY_FILLED")`（trading-engine）や永続層の status 既定を揺らさずに「PENDING のまま休眠（WAITING）」を表せるため。IFD 子は `status=PENDING` かつ `activation=WAITING` で受付し、親約定でエンジンが `activation=ACTIVE` へ遷移。
- `trading-engine.ts` `TradingEngine` に **optional メソッド**追加（既存の単発のみ実装/フェイクを壊さない）:
  - `placeBracketOrder?(cmd: PlaceBracketOrderCommand): Promise<Order[]>`。
  - `cancelOrderGroup?(linkGroupId: string): Promise<Order[]>`（グループ一括取消）。
  - 既存 `placeOrder`/`cancelOrder`/`evaluateOpenOrders` は据え置き。カスケード（OCO 片約定→他方取消、IFD 親約定→子発効）は `evaluateOpenOrders` の約定処理内で実装する想定。

**却下案**:
- 「`PlaceOrderCommand` に link フィールドを足して単発と複合を 1 コマンドに統合」→ 既存 `superRefine`（type 別 price 検証）に OCO/IFD 用の cross-leg 検証が混入し肥大化・後方互換リスク。別コマンドに分離して却下回避。
- 「`OrderStatus` に WAITING/INACTIVE を追加」→ 既存の status 判定・永続層既定・exhaustive 比較を揺らす破壊リスク。直交軸 `activation` で代替し却下。
- 「専用 `OrderLink` 結合テーブルを必須化」→ Order の optional 列だけでカスケードは成立するため過剰。読み取り用 `OrderGroup` 型のみ提供し永続化は後続判断に委ねた。

### 2) 建玉一意キー: `[accountId, instrumentId, side]` → `[..., marginType]`

- `portfolio.ts`: `POSITION_UNIQUE_KEY = ["accountId","instrumentId","side","marginType"]` を新設し JSDoc で含意を明記。`Position.marginType` は型上は optional（既存 record 手組みの後方互換）だが **一意キー要素としては実質必須＝未指定は CASH**（`marginType ?? "CASH"` で一意性判定）。永続層 `@default(CASH)`。
- `db` schema: Position の `@@unique` を `[accountId, instrumentId, side, marginType]` へ変更。既存行は marginType=CASH（Phase 3 で DEFAULT 付与済み）のため新キーでも一意性が保たれ後方互換。
- 手書きマイグレーション `prisma/migrations/20260623_phase5_compound_orders_position_key/migration.sql`:
  - 旧制約 `Position_accountId_instrumentId_side_key` を DROP（`IF EXISTS`）→ 新 4 列 UNIQUE を ADD。
  - Order に `linkGroupId/linkType/parentOrderId/activation` 列追加（NULL 許容・`activation @default(ACTIVE)`）＋ enum `OrderLinkType`/`OrderActivation` 作成＋索引（linkGroupId/parentOrderId）。
  - すべて DEFAULT 付き ADD COLUMN / NULL 許容で後方互換。`prisma validate` green。

### 後続実装担当への申し送り
- **apps/api（次 Wave。重要・必須対応）**:
  - Position の upsert キー名が **`accountId_instrumentId_side` → `accountId_instrumentId_side_marginType`** に変わる。`prisma-position.repository`（または相当）の `where: { accountId_instrumentId_side: {...} }` を `where: { accountId_instrumentId_side_marginType: { accountId, instrumentId, side, marginType: marginType ?? "CASH" } }` に修正する。`marginType` 未指定の現物は明示的に `"CASH"` を渡すこと（DB 既定に頼らず where では値が必須）。
  - 既存の現物建玉は marginType=CASH で 1 行のままなので、既存データの移行は不要（後方互換）。
  - 複合注文 API: `placeBracketOrder` / `cancelOrderGroup` を HTTP に出すなら spec §6.8 にエンドポイント追記（例 `POST /accounts/:id/orders/bracket`、`DELETE /orders/groups/:linkGroupId`）。出さない場合は agent/web からは単発のみ。
- **trading-engine（複合注文実装）**:
  - `placeBracketOrder(cmd)`: 各 leg/parent/child を `PlaceOrderCommand.safeParse` で個別検証（price 妥当性はここで担保）。OCO は 2 脚に共通 `linkGroupId`＋`linkType=OCO`・両 `activation=ACTIVE`。IFD は親 ACTIVE・子に `parentOrderId`＋`linkType=IFD`＋`activation=WAITING`。BRACKET は親 ACTIVE・子 2 本に共通 `linkGroupId`(OCO)＋共通 `parentOrderId`(IFD 親)＋`activation=WAITING`。
  - `evaluateOpenOrders`: `activation=WAITING` の注文は約定評価から除外（休眠）。約定確定時に (a) 同 `linkGroupId` の他注文を CANCELLED（OCO カスケード）、(b) `parentOrderId === filledOrderId` の子を `activation=ACTIVE` へ発効（IFD カスケード）。bracket は (a)+(b) が連鎖する。
  - `cancelOrderGroup(linkGroupId)`: 同グループのオープン/WAITING 注文を一括 CANCELLED。
  - リポジトリ IF（`OrderRepository`）に `findByLinkGroupId`/`findByParentOrderId` 相当が要るなら contracts へ追加提案（現状 Order に索引対応列はあるので実装側の port 追加で足りる見込み。必要なら domain-architect へ）。
- **portfolio**: 建玉分離の影響は upsert キー（api 担当）が主。`applyTrade` で建玉を引く際の一意性は `(accountId, instrumentId, side, marginType ?? "CASH")` で評価すること。CASH/MARGIN を別建玉として積み上げる（既に marginType で Trade を振り分ける Phase 3 方針と整合）。
- **web**: bracket 発注 UI（利確/損切セット）と OCO/IFD 状態表示を出すなら `Order.activation`(WAITING=待機) と `linkGroupId`/`parentOrderId` で関係を可視化。投資助言表現は入れない（spec §9）。

### 未決事項 / 要調整
- `PlaceBracketOrderCommand` の leg を `z.unknown()` にしたため、contracts 単体では各脚の price 妥当性を検証しない（trading-engine が `PlaceOrderCommand` で検証）。将来 `PlaceOrderCommand` を別ファイルへ切り出して循環を解けば、leg を厳密型にできる（**型締め候補**。現契約でも実装可）。
- `OrderGroup` の永続化（専用テーブル）は現状見送り。グループ単位の監査要件が強くなれば DB 化を検討（過剰設計回避）。
- IFD 子の有効期限: 親約定前に親が EXPIRED/CANCELLED された場合の子の扱い（連動 CANCELLED が妥当）はカスケード規則として trading-engine 実装で確定し、必要なら不変条件を spec §5.2 に追記提案。

### spec 更新提案
- spec §6.2 `TradingEngine` IF に複合注文メソッドを同期追記してよい（IF は contracts が真実だが spec も一次情報のため）。破壊的でない追記:
  「`placeBracketOrder?(cmd: PlaceBracketOrderCommand): Promise<Order[]>` // OCO/IFD/bracket（P2。optional）」
  「`cancelOrderGroup?(linkGroupId): Promise<Order[]>` // グループ取消（P2。optional）」。
- spec §5.1 Position 行に一意キーの含意を補記提案: 「Position は `(accountId, instrumentId, side, marginType)` で一意（CASH/MARGIN 同方向建玉を分離。Phase 5）」。
- spec §5.2 不変条件に追記提案: 「OCO グループは同時に高々 1 件のみ FILLED（他は CANCELLED）」「IFD 子は親が FILLED になるまで約定しない（WAITING）」。
- spec §6.8 に Phase 5 新ルートの追記提案: `POST /accounts/:id/orders/bracket`（複合発注）、`DELETE /orders/groups/:linkGroupId`（グループ取消）。現状は整合性チェックで §6.8 未記載 WARN（許容）。

### Phase 5 実装完了サマリ（2026-06-23, ブランチ `integration/phase5`）
contracts→trading-engine→portfolio→api を依存方向に沿って実装し全ゲート green（test 384→418、整合性 ERROR 0/WARN 10）。各層の成果と**新規に判明した申し送り**:
- **trading-engine**（46 テスト, +11）: `placeBracketOrder`/`cancelOrderGroup` 実装。`evaluateOpenOrders` に WAITING 除外＋約定時カスケード（OCO 片約定→他方取消／IFD 親約定→子発効）。内部ポート `OrderRepository` に `findByLinkGroupId`/`findByParentOrderId` を追加（contracts 変更不要。実 DB アダプタは apps/api 側で索引利用実装）。親 EXPIRED/CANCELLED 時は未発効 WAITING 子を連動 CANCELLED（孤児防止）。
- **portfolio**（38 テスト, +5）: 建玉キーを `(accountId, instrumentId, side, marginType ?? "CASH")` に拡張し CASH/MARGIN 同方向建玉を別行集計。現物のみフローは保存時 `?? "CASH"` で従来と同一キーに集約＝後方互換。
  - **要 domain-architect（新規申し送り）→ ✅ Phase 8 で対応済み**: `TaxLot` に `marginType` が無く、税ロットは `(accountId, instrumentId)` 単位。既定 AVERAGE では Position の avgCost から実現損益を出すため建玉分離は正しく反映され問題なし。**FIFO/LIFO では同一銘柄の CASH/MARGIN ロットが混在し取り崩し順・原価が混ざり得る**（数量/評価は正・税ロット内訳の厳密な建玉別分離は不可）。完全分離には `TaxLot.marginType` 追加＋`listTaxLots` の絞り込み＋`consumeTaxLots`/`appendTaxLot` 連動が必要（契約追加候補）。→ 下「Phase 8 契約」節参照。
- **apps/api**（25 テスト, +5）: `PrismaOrderRepository.findByLinkGroupId`/`findByParentOrderId` 実装、Order マッパに link 列、Position upsert キーを `accountId_instrumentId_side` → `accountId_instrumentId_side_marginType`（現物は where に `"CASH"` 明示）。新ルート `POST /accounts/:id/orders/bracket`・`DELETE /orders/groups/:linkGroupId`。
  - **申し送り（情報共有）**: (1) Phase 5 で Prisma schema が変わったため、pull 後の typecheck/test 前に `corepack pnpm@9.12.0 -r generate`（または `--filter @stonks/db generate`）が必須（`pnpm verify` は先頭で generate するので verify 経由なら自動）。(2) apps/api は `MarginPolicyProvider` 未配線のため MARGIN 発注は engine 側で一律拒否される。MARGIN の HTTP 発注を露出するには MarginPolicyProvider の結線が別途必要（今回の CASH/MARGIN 分離は portfolio の applyTrade 経由で担保済み・契約上の問題なし）。
- **未実施（次 Wave 候補・任意）**: web の bracket 発注 UI と OCO/IFD 状態可視化（`Order.activation`/`linkGroupId`/`parentOrderId`）。contracts 変更不要で frontend-dev 単独で進められる。

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

### B5. `PlaceOrderCommand` に成行買いの予算上限 ⏸ 型締めでは見送り（実装連動）
- 成行買いは発注時に約定価格が未確定で事前現金チェックができない（現状は約定時に portfolio 側で反映）。
- 任意の `estimatedPrice` か `maxNotional` があると事前チェックを厳密化できる。
- → **見送り理由**: これは「緩い既存型の厳格化」ではなく**新フィールドの追加（新機能）**。フィールド単体の追加は後方互換だが、値が意味を持つには trading-engine の発注前チェックロジックの追加（消費側）が必須で、契約だけ足しても挙動が変わらず宙に浮く（実装連動）。今回の型締め（ランタイム等価）スコープ外。実装する場合は trading-engine の発注前チェック実装とセットで domain-architect が追加する。

### B6. `FillModel.tryFill` がステートレス ⏸ 型締めでは見送り（IF シグネチャ＋実装連動）
- STOP/STOP_LIMIT のトリガ判定は本質的にステートフル（一度発火で維持）。trading-engine は engine 側でトリガ状態を管理して回避。
- backtest と約定ロジックを共有するなら、トリガ判定込みの評価 IF を契約に明示すると再利用しやすい。
- → **見送り理由**: `FillModel` の IF シグネチャ変更（状態の受け渡し）が必要で、trading-engine / backtest 両方の実装変更を伴う。型表現の厳格化ではなく IF 設計変更＋実装連動のため今回スコープ外。共有評価 IF を新設するなら domain-architect が両実装と協調して設計する。

### B7. 手数料の表現 `Money` 統一 ⏸ 型締めでは見送り（破壊的・構造変更）
- `Trade.fee` は `DecimalString` 単体、`FeeModel.calculate` は `{ fee: Money }`。currency は Trade 側にあり整合は取れているが、`Money` に統一する余地。
- → **見送り理由**: `Trade.fee: DecimalString`（例 `"10"`）→ `Money`（`{amount, currency}`）は**文字列→オブジェクトの構造変更で破壊的**。既存の永続データ・フィクスチャ・portfolio/engine の Trade 手組みコードが parse 不能になる（ランタイム非等価）。currency は `Trade.currency` で既に整合が取れており不変条件違反もない。統一するなら DB マイグレーション＋全 Trade 生成箇所の追従が必要で、型締めの範囲を超える。

### B8. `RiskGuard.check` のシグネチャ ⏸ 型締めでは見送り（IF シグネチャ＋実装連動）
- 現在 同期＋`(accountId, action)` のみ。現金/集中度/日次累計の判定に口座状態が要るため、agent-trader は内部 `RiskState` を構築して注入。
- `check(accountId, action, context)` か `Promise` 戻り化を検討すると、状態取得を RiskGuard 内に閉じられる。
- → **見送り理由**: `RiskGuard.check` の引数追加 or 非同期化は IF シグネチャ変更で、agent-trader の RiskGuard 実装・呼び出し側の協調変更を伴う（型表現の厳格化ではない）。さらに「状態取得を RiskGuard 内に閉じる」設計判断（AccountStateProvider を RiskGuard に注入するか）が絡むため、agent-trader と協調して domain-architect が別途設計する。

### B9. 成績評価の基準点 ⏸ 一部（getHistory 意味の明文化）のみ対応・基準点正確化は見送り
- `PerformanceSnapshot.cumulativeReturn` は初期エクイティ点が必要。portfolio は約定ごとに EquityPoint を記録するため、入金直後の基準点が無いと基準が最初の約定後になる。入金時点のスナップショットがあると正確。
- `getHistory` のエクイティ意味（mark-to-market か cost basis か）が未定義。現状は cost basis（provider 非依存・決定的）。
- → **一部対応（ドキュメントのみ・ランタイム非変更）**: `PortfolioService.getHistory` の JSDoc に「エクイティ系列はコストベース（決定的・provider 非依存）」であることを明文化（B9 後半の「意味が未定義」を解消）。型・スキーマ変更なし。
- → **見送り（基準点正確化）**: 入金時点スナップショットの追加は portfolio の EquityPoint 記録タイミング（deposit 時に基準点を打つ）の**実装変更**であり、契約の型締めでは解決しない。portfolio 実装タスクで対応する（必要なら IF 追加を別途提案）。

## 優先度低（任意・型の締め付け）

### B10. `IndicatorResult.ts` の型 ✅ 対応済み
- `z.array(z.string())` で任意文字列。入力 `PriceBar.ts` は `Timestamp` なので `ts: z.array(Timestamp)` に締めても良い（任意）。
- → 対応済み: `IndicatorResult.ts` を `z.array(Timestamp)`（UTC ISO8601）へ締めた。出力 ts は入力 `PriceBar.ts` 由来でランタイム挙動の変化なし（contracts 30 / analytics 22 テスト green）。

### B11. `IndicatorSpec.params` の discriminated union 化 ⏸ 型締めでは見送り（ランタイム非等価＋実装連動）
- 現在 `z.record(z.number())` で MACD の fast/slow/signal も同居。kind 別 union 化で型安全性が上がる（現契約でも実装可）。
- → **見送り理由**: (1) **ランタイム非等価**: kind 別 union 化すると「kind に対応しないキーを含む params（例 `{kind:"SMA", params:{slow:2}}`）」が現在は parse 成功するのに失敗するようになり、緩い型の厳格化を超えて**受理集合を狭める**（後方互換リスク）。(2) **実装連動**: analytics の `service.ts` は `spec.params[key]`（`intParam`/`numParam` ヘルパ）で **任意の文字列キーで params を添字アクセス**しており、union 化すると各メンバの既知キーのみになり `params[key: string]` がコンパイルできず analytics 側の実装変更が必須。型表現の厳格化のみでは閉じない。union 化を行うなら analytics と協調して domain-architect が `params` の添字アクセス方式ごと再設計する。

### B12. `CorporateAction` 取得 IF ✅ 対応済み
- 型はあるが `MarketDataProvider` に取得メソッドが無い（分割/配当の取り込み）。Phase 1 で IF 追加を提案。
- → 対応済み（Phase 4）: `market-data.ts` に `GetCorporateActionsRequest`（`GetBarsRequest` に倣う。`instrumentId`/`from`/`to`、UTC）を追加し、`MarketDataProvider.getCorporateActions?(req): Promise<CorporateAction[]>` を **optional メソッド**として追加。理由: 唯一の具象実装 `MarketDataRegistry` と apps のフェイクが `implements MarketDataProvider` のため、必須化すると両者が壊れる。レジストリはアダプタの method 有無で `candidates` をフィルタするので、対応アダプタのみ提供できる設計と整合（未提供は ingestion 側でスキップ/フォールバック）。対応アダプタが揃ったら必須化を検討。

## Phase 7.2 契約: 緩い Zod の型締め（ランタイム等価）✅ 反映済み

> B5〜B9 / B11 の精査ついでに見つかった、**緩い既存 Zod を厳格化してもランタイム挙動が変わらない**
> 箇所を `domain-architect` が締めた（B10 の前例に倣う）。**すべて型表現の厳格化のみで後方互換**
> （既存の有効データ・全テストを壊さない。contracts 45→52 テスト green、全体 verify ERROR 0/WARN 10 据え置き）。
> B5〜B9 / B11 本体は「破壊的 or 実装連動」のため今回見送り（各項目に理由を記載）。

### 締めた箇所（`packages/contracts`）
- `backtest.ts` `BacktestResult.equityCurve[].ts`: `z.string()` → `Timestamp`（UTC ISO8601）。
  値は backtest runner（`packages/backtest/src/runner.ts`）が `Date#toISOString()` で生成する UTC 時刻のため
  ランタイム等価。`EquityPoint.ts`（portfolio）と同形式に揃え、エクイティ系列の ts 表現を一貫化。
- `agent.ts` `AgentObservation.cashByCurrency`: `z.record(DecimalString)` → `z.record(Currency, DecimalString)`。
  キーは `summary.baseCurrency` 等 `Currency` 値でのみ引かれる（agent-trading-service の `buildObservation`）。
  Zod v3 の enum-key record は**部分集合・空オブジェクトを許容**する（exhaustive 強制なし）ため、
  `{ JPY: ... }` のみ・`{}` も parse 成功でランタイム等価。未知通貨キーのみ弾く厳格化。
- `agent.ts` `AgentObservation.positions[].quantity`: `z.number()` → `Quantity`（finite・nonnegative）。
  値は `PositionView.quantity`（既に `Quantity`）由来で SHORT も数量は非負（方向は side で表現）。ランタイム等価。
- `portfolio.ts` `PortfolioService.getHistory` の JSDoc に「エクイティ系列はコストベース（決定的・provider 非依存）」を
  明文化（B9 後半の「意味未定義」を解消。型・スキーマ変更なし）。

### 契約テストのピン（厳格化の検証）
- `contracts.test.ts` に追加: `cashByCurrency` の部分集合/空/未知キー/非 Decimal 値、`positions[].quantity` 負値拒否、
  `equityCurve[].ts` の UTC ISO 受理/非タイムスタンプ拒否。

### 下流影響
- なし（全パッケージの typecheck/test green）。締めた値はいずれも下流が既に厳格形で生成しており、
  下流コードの変更は不要（contracts 側のみ）。

## Phase 8 契約: 税ロットの資金区分（TaxLot.marginType）✅ 反映済み

> Phase 5 申し送り「FIFO/LIFO で同一銘柄の CASH/MARGIN 税ロットが取り崩し順・原価で混ざり得る」を
> 解消するための契約先行。`domain-architect` が `TaxLot` に資金区分を追加。**すべて追加的・後方互換**
> （Trade/Position の `marginType` と同じ optional 方針。既存の税ロット行/全テストを壊さない）。

### 追加した型/スキーマ
- `packages/contracts/src/tax-lot.ts` `TaxLot` に `marginType: MarginType.optional()`（`./margin.js` から import）。
  未指定=CASH 現物として解釈（読み手は `marginType ?? "CASH"`）。`.default()` ではなく optional にするのは
  z.infer 出力型を必須化せず既存の手組み record / 他フィールド方針（acquiredTradeId 等）と揃えるため。
  `RealizedPnlWithLots` / `TaxLotConsumption` は変更なし（内訳は taxLotId 経由で辿れる）。
- `packages/contracts/src/contracts.test.ts` にピン追加（marginType 省略=後方互換 / "MARGIN" 受理 / 不正値 reject）。
- `packages/db` `model TaxLot` に `marginType MarginType @default(CASH)` 列。手書き migration
  `20260624_phase8_taxlot_margin_type/migration.sql`（DEFAULT 'CASH' 付き ADD COLUMN。enum MarginType は Phase 3 既存）。
- spec §5.1 TaxLot 行に marginType を同期追記。

### 後続実装担当への申し送り
- **portfolio（次トラック）**: 取得（買い）で起こす TaxLot に `marginType: trade.marginType ?? "CASH"` を付与。
  `consumeTaxLots` は `listTaxLots` で引いた後 `marginType ?? "CASH"` が売り Trade の区分と一致するロットのみを
  取り崩す（CASH/MARGIN を混ぜない）。`listTaxLots`（portfolio 内部ポート、contracts ではない）に marginType
  絞り込み引数を足すか service 内フィルタにするかは実装裁量。`PortfolioService.getTaxLots` の公開 IF は変更しない
  （返る TaxLot が marginType を自己記述するため）。
- **apps/api（次トラック）**: `PrismaPortfolioRepository` の appendTaxLot/saveTaxLot/listTaxLots で marginType を往復。
  現物（marginType 未指定）は DB 既定 CASH に倒れるが、where/select では明示的に扱うこと。

### 未決事項
- AVERAGE は Position の avgCost ベースで実現損益を出すため建玉分離の影響を受けない（数量/評価は従来どおり正）。
  本対応は FIFO/LIFO/SPECIFIC_LOT の取り崩しロット選択の厳密化が主眼。
- `getTaxLots` に marginType フィルタ引数を足すかは現状不要（呼び手が返り値で振り分け可能）。要件が出たら IF 追加を別途検討。

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
