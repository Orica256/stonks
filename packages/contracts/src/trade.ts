import { z } from "zod";
import {
  Currency,
  DecimalString,
  Id,
  Quantity,
  Timestamp,
} from "./common.js";
import { MarginType } from "./margin.js";
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
  /**
   * 資金区分（任意。未指定は CASH=現物として扱う。Phase 3）。
   * MARGIN は信用約定。portfolio はこれで建玉を CASH/MARGIN に振り分け、
   * 税ロット/保証金を更新する。既存の現物 Trade と後方互換にするため optional
   * （永続層は Prisma の `@default(CASH)` で値を持つ）。
   */
  marginType: MarginType.optional(),
  executedAt: Timestamp,
});
export type Trade = z.infer<typeof Trade>;

/** 約定モデルが返す約定試行結果。 */
export const Fill = z.object({
  quantity: Quantity,
  price: DecimalString,
});
export type Fill = z.infer<typeof Fill>;
