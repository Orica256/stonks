import type { Money } from "./common.js";
import type { Instrument } from "./instrument.js";
import type { MarginPolicy } from "./margin.js";
import type { PriceProvider } from "./market-data.js";
import type { Order, PlaceOrderCommand } from "./order.js";
import type { PlaceBracketOrderCommand } from "./order-link.js";
import type { Fill, Trade } from "./trade.js";

/** 手数料モデル（市場別。spec §6.2）。 */
export interface FeeModel {
  calculate(input: {
    instrument: Instrument;
    side: Order["side"];
    quantity: number;
    price: string; // DecimalString
  }): { fee: Money };
}

/** 約定モデル（成行/指値の約定判定とスリッページ）。 */
export interface FillModel {
  tryFill(order: Order, marketPrice: string): Fill | null;
}

/**
 * 信用建ての保証金/金利規定値プロバイダ（Phase 3。spec §2.2）。
 *
 * trading-engine が銘柄ごとの必要保証金率・金利を解決するための最小ポート。
 * 信用不可銘柄は null を返す（その場合 MARGIN 発注は拒否される）。
 * 規定値の出所（設定/市場ルール）は実装側に委ねる。
 */
export interface MarginPolicyProvider {
  getMarginPolicy(instrumentId: string): Promise<MarginPolicy | null>;
}

/**
 * trading-engine の公開契約（spec §6.2）。
 * 価格は PriceProvider 経由で取得し market-data を直接 import しない。
 */
export interface TradingEngine {
  placeOrder(cmd: PlaceOrderCommand): Promise<Order>;
  cancelOrder(orderId: string): Promise<Order>;
  /** 価格更新時にオープン注文を評価し、約定（Trade）を生成する。 */
  evaluateOpenOrders(ctx: {
    now: Date;
    priceProvider: PriceProvider;
  }): Promise<Trade[]>;

  /**
   * 複合注文（OCO / IFD / bracket）の発注（spec §2.2 P2。Phase 5）。
   *
   * 各 leg/親/子を `PlaceOrderCommand` として個別検証し、`linkGroupId`（OCO）/
   * `parentOrderId`＋`activation`（IFD）を張った `Order` 群を作成して返す。
   * - OCO: 2 脚を `linkGroupId` で束ね、両方 ACTIVE で受付。
   * - IFD: 親を ACTIVE、子を `parentOrderId` 付き `activation=WAITING` で受付。
   * - BRACKET: 親 ACTIVE＋子 2 本（WAITING・共通 `linkGroupId` で OCO・共通 `parentOrderId`）。
   *
   * 後方互換のため **optional メソッド**（既存の単発のみ実装/フェイクを壊さない）。
   * trading-engine の複合注文実装タスクで提供し、揃ったら必須化を検討する。
   * カスケード（OCO 片約定→他方取消、IFD 親約定→子発効）は `evaluateOpenOrders` の
   * 約定処理内で行う（約定都度、同 group/子の状態遷移を反映）。
   */
  placeBracketOrder?(cmd: PlaceBracketOrderCommand): Promise<Order[]>;

  /**
   * 複合注文グループ単位の取消（spec §2.2 P2。Phase 5。任意）。
   *
   * `linkGroupId` に属するオープン注文（および IFD 子の WAITING 注文）を一括取消する。
   * 単発の `cancelOrder` は据え置き。OCO の明示取消や bracket の建て直しに使う。
   * 後方互換のため **optional**。
   */
  cancelOrderGroup?(linkGroupId: string): Promise<Order[]>;
}
