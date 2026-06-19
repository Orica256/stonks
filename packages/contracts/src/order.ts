import { z } from "zod";
import { DecimalString, Id, Quantity, Timestamp } from "./common.js";

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
