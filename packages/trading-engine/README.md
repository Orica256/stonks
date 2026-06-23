# @stonks/trading-engine

注文ライフサイクル・約定シミュレーション・手数料/スリッページ計算（spec §2.2・§6.2）。
公開契約は `@stonks/contracts` の `TradingEngine` / `FeeModel` / `FillModel` に準拠する。

## 責務
- **発注 (`placeOrder`)**: `PlaceOrderCommand` を Zod 検証 → 単元株（`isValidLot`）・呼値刻み（`roundToTick`）＋現金/保有の事前チェック → `PENDING` 受付。
- **取消 (`cancelOrder`)**: `PENDING` / `PARTIALLY_FILLED` のみ取消可。それ以外は `DomainError("ORDER_NOT_CANCELLABLE")`。
- **評価 (`evaluateOpenOrders`)**: `PriceProvider` から価格を取り、`FillModel` で約定判定。成行=即時、指値=価格到達、逆指値/ストップリミット=トリガ。部分約定・状態遷移・DAY 当日失効を処理し、約定ごとに `Trade` と手数料（`FeeModel`）を生成。複合注文のカスケード（後述）もこの中で処理する。
- **複合注文 (`placeBracketOrder` / `cancelOrderGroup`。Phase 5)**: OCO / IFD / bracket を発注し、約定/取消の連動（カスケード）を管理する。

### 複合注文（OCO / IFD / bracket。spec §2.2 P2）
- **発注 (`placeBracketOrder(cmd: PlaceBracketOrderCommand)`)**: `kind` で分岐。各 leg/parent/child を `PlaceOrderCommand` として個別に Zod 検証（price 妥当性・単元・現金/保有チェックを流用）し、全脚通過後にまとめて保存（all-or-nothing。1 脚でも不正なら `DomainError` で全体を弾き、何も保存しない）。`Order[]` を返す。
  - `OCO`: 2 脚に共通 `linkGroupId`＋`linkType="OCO"`、両 `activation="ACTIVE"`。
  - `IFD`: 親 `activation="ACTIVE"`、子（1 本以上）に `parentOrderId=親id`＋`linkType="IFD"`＋`activation="WAITING"`。
  - `BRACKET`: 親 ACTIVE、子 2 本に共通 `linkGroupId`(OCO)＋`parentOrderId=親id`＋`linkType="OCO"`＋`activation="WAITING"`。
- **カスケード（`evaluateOpenOrders` 内）**:
  - `activation="WAITING"` の注文は約定評価から**除外**（休眠）。`findOpen` は `status=PENDING` を返すため `activation` で明示的に弾く。
  - 約定確定時（FILLED または「最初の」部分約定 = `filledQuantity` が 0→正）に、(a) 同 `linkGroupId` の他注文を `CANCELLED`（OCO）、(b) 約定注文を親に持つ WAITING 子を `activation="ACTIVE"` に発効（IFD）。bracket は親約定で子 2 本が発効→子の片約定で他方取消、と連鎖する。
  - 同一パス内の整合性: 評価直前に各注文を `findById` で読み直し、先行約定のカスケードで終端状態化/取消済みになっていれば評価しない。WAITING はパス開始時スナップショットの `activation` でも判定し、同一パスで発効した子は**次パスから**約定対象とする。
  - 孤児防止: 親が EXPIRED（DAY 失効）/`cancelOrder` された場合、未発効の WAITING 子を連動 `CANCELLED` にする。
- **グループ取消 (`cancelOrderGroup(linkGroupId)`)**: 同 `linkGroupId` のオープン（PENDING/PARTIALLY_FILLED）と WAITING 子を一括 `CANCELLED`。終端状態（FILLED/CANCELLED 等）は据え置く。取消した `Order[]` を返す。
- **リポジトリポート拡張**: カスケード解決のため `OrderRepository` に `findByLinkGroupId` / `findByParentOrderId` を追加（in-memory 実装同梱）。注文一覧表示用に `listByAccount(accountId)` も追加（状態に依らず全件・`createdAt` 降順）。

## 設計上の制約（厳守）
- **価格は `PriceProvider` IF 経由のみ**。`market-data` を直接 import しない（spec §4.3・§6.2）。
- **金額は浮動小数禁止**。`@stonks/core-domain` の `Money`（decimal.js）で計算（CLAUDE.md §0）。
- **永続化は db に直接依存しない**。内部ポート `OrderRepository` と contracts の `AccountStateProvider` / `InstrumentResolver`（B2。`InstrumentProvider` は後者の別名）に対して DI し、in-memory 実装を同梱（実 DB / portfolio 結線は apps/api 側）。

## 不変条件
- `filledQuantity <= quantity`、`FILLED` は `filledQuantity == quantity`。
- 売り数量 ≤ 保有（超過は `INSUFFICIENT_POSITION`）。指値買いは現金不足で `INSUFFICIENT_FUNDS`。
  - 注: 成行買いは事前に正確なコストを確定できないため事前現金チェックの対象外（約定時に portfolio 側で残高反映する想定）。

## 公開 API
```ts
import {
  StandardTradingEngine,   // TradingEngine 実装
  StandardFeeModel,        // FeeModel 実装（JP 段階制 / US 株数ベース+規制手数料）
  SlippageFillModel,       // FillModel 実装（成行/指値の約定とスリッページ）
  InMemoryOrderRepository,
  InMemoryAccountStateProvider,
  InMemoryInstrumentProvider,
} from "@stonks/trading-engine";

const engine = new StandardTradingEngine({
  orders: new InMemoryOrderRepository(),
  accountState: new InMemoryAccountStateProvider(),
  instruments: new InMemoryInstrumentProvider([instrument]),
  feeModel: new StandardFeeModel(),
  fillModel: new SlippageFillModel(),
});

const order = await engine.placeOrder(cmd);
const trades = await engine.evaluateOpenOrders({ now: new Date(), priceProvider });
```

### 手数料モデル（`StandardFeeModel`）
- **JP**: 約定代金の段階制手数料 + 消費税（国内ネット証券の現物プランを模した近似）。整数円に切り上げ。
- **US**: 1 株あたりコミッション（最低額・約定代金比上限あり）+ 売却時の規制手数料（SEC/TAF 風の近似）。セント単位に切り上げ。
- 既定値は `DEFAULT_FEE_CONFIG`。`FeeModelConfig` で差し替え可能。

### 約定モデル（`SlippageFillModel`）
- 成行: 常に約定し、スリッページを不利方向（BUY=上, SELL=下）に適用。
- 指値: BUY は `market <= limit`、SELL は `market >= limit` で約定。
- 逆指値/ストップリミット: engine がトリガ状態を管理し、トリガ後に成行/指値として評価。
- 既定スリッページ率は `DEFAULT_FILL_CONFIG`（5bps）。

### 部分約定
`TradingEngineDeps.liquidity`（`LiquidityModel`）で 1 評価あたりの最大約定数量を制御する。既定は全量約定。

## コマンド
```
corepack pnpm@9.12.0 --filter @stonks/trading-engine typecheck
corepack pnpm@9.12.0 --filter @stonks/trading-engine test
```
