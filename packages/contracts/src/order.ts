import { z } from "zod";
import { DecimalString, Id, Quantity, Timestamp } from "./common.js";
import { MarginType } from "./margin.js";
import { OrderActivation, OrderLinkType } from "./order-link.js";

export const OrderSide = z.enum(["BUY", "SELL"]);
export type OrderSide = z.infer<typeof OrderSide>;

export const OrderType = z.enum(["MARKET", "LIMIT", "STOP", "STOP_LIMIT"]);
export type OrderType = z.infer<typeof OrderType>;

export const TimeInForce = z.enum(["DAY", "GTC"]);
export type TimeInForce = z.infer<typeof TimeInForce>;

export const OrderStatus = z.enum([
  "PENDING",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const Order = z.object({
  id: Id,
  accountId: Id,
  instrumentId: Id,
  side: OrderSide,
  type: OrderType,
  quantity: Quantity,
  filledQuantity: Quantity.default(0),
  limitPrice: DecimalString.optional(),
  stopPrice: DecimalString.optional(),
  timeInForce: TimeInForce.default("DAY"),
  /**
   * 資金区分（任意。未指定は CASH=現物として扱う。Phase 3）。
   * MARGIN は信用建て。SELL × MARGIN は新規ショート建て、BUY × MARGIN は
   * 買い建て/返済（建て/返済の判別は trading-engine が建玉状況から決定する）。
   * 既存の現物 Order（marginType 未設定）と後方互換にするため optional。
   * 永続層は Prisma の `@default(CASH)` で必ず値を持つ。
   */
  marginType: MarginType.optional(),
  /**
   * 複合注文のグループ ID（OCO / bracket 子。任意。Phase 5）。
   * 同一 `linkGroupId` の注文は 1 グループとして連動し、片方が約定したらエンジンが
   * 残りを CANCELLED にする（OCO カスケード）。未設定（=従来の単発注文）は連動しない。
   */
  linkGroupId: Id.optional(),
  /**
   * 複合注文の種別（OCO / IFD。任意。Phase 5）。
   * - OCO: `linkGroupId` で束ねた他方の約定で自身が取消される。
   * - IFD: 親（`parentOrderId`）の約定で発効する子、または子を持つ親に付与。
   * 未設定は単発注文。
   */
  linkType: OrderLinkType.optional(),
  /**
   * IFD/bracket の親注文 ID（任意。Phase 5）。
   * これが約定すると、本注文（子）が `activation` WAITING→ACTIVE に発効する。
   * 親注文自身は `parentOrderId` を持たない。
   */
  parentOrderId: Id.optional(),
  /**
   * 発効状態（任意。未指定/`ACTIVE` はエンジンの約定評価対象。Phase 5）。
   * IFD 子は発注時 `WAITING`（親約定まで休眠）で、親約定でエンジンが `ACTIVE` に遷移。
   * 単発の従来注文は未指定のままで ACTIVE 相当として扱われる（後方互換）。
   * 永続層は Prisma `@default(ACTIVE)`。
   */
  activation: OrderActivation.optional(),
  status: OrderStatus.default("PENDING"),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Order = z.infer<typeof Order>;

/**
 * 発注コマンド。type ごとに必要な価格を superRefine で検証する。
 */
export const PlaceOrderCommand = z
  .object({
    accountId: Id,
    instrumentId: Id,
    side: OrderSide,
    type: OrderType,
    quantity: Quantity.refine((q) => q > 0, "quantity must be > 0"),
    limitPrice: DecimalString.optional(),
    stopPrice: DecimalString.optional(),
    timeInForce: TimeInForce.default("DAY"),
    /**
     * 資金区分（任意。未指定は CASH=現物として扱う。Phase 3）。
     * 入力コマンドでは optional に保ち、既存の現物フロー（marginType を渡さない
     * 呼び出し）と後方互換にする。trading-engine が未指定を CASH と解釈する。
     */
    marginType: MarginType.optional(),
  })
  .superRefine((cmd, ctx) => {
    const needsLimit = cmd.type === "LIMIT" || cmd.type === "STOP_LIMIT";
    const needsStop = cmd.type === "STOP" || cmd.type === "STOP_LIMIT";
    if (needsLimit && cmd.limitPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["limitPrice"],
        message: `limitPrice is required for ${cmd.type}`,
      });
    }
    if (needsStop && cmd.stopPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stopPrice"],
        message: `stopPrice is required for ${cmd.type}`,
      });
    }
    if (cmd.type === "MARKET" && cmd.limitPrice !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["limitPrice"],
        message: "MARKET order must not set limitPrice",
      });
    }
  });
export type PlaceOrderCommand = z.infer<typeof PlaceOrderCommand>;
