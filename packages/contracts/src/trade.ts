import { z } from "zod";
import {
  Currency,
  DecimalString,
  Id,
  Quantity,
  Timestamp,
} from "./common.js";
import { OrderSide } from "./order.js";

/** 約定 = 取引履歴の 1 件（spec §5.1 Trade / Execution）。 */
export const Trade = z.object({
  id: Id,
  orderId: Id,
  accountId: Id,
  instrumentId: Id,
  side: OrderSide,
  quantity: Quantity,
  price: DecimalString,
  fee: DecimalString,
  currency: Currency,
  executedAt: Timestamp,
});
export type Trade = z.infer<typeof Trade>;

/** 約定モデルが返す約定試行結果。 */
export const Fill = z.object({
  quantity: Quantity,
  price: DecimalString,
});
export type Fill = z.infer<typeof Fill>;
