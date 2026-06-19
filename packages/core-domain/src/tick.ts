import Decimal from "decimal.js";
import type { Instrument, OrderSide, TickRule } from "@stonks/contracts";

/**
 * 呼値（tick size）と単元株のルール（spec §2.2）。
 */

/** price に適用すべき tick size を返す（tickRules は priceFrom 昇順を想定）。 */
export const tickSizeFor = (
  price: Decimal.Value,
  tickRules: TickRule[],
): Decimal | null => {
  if (tickRules.length === 0) return null;
  const p = new Decimal(price);
  let applicable: TickRule | null = null;
  for (const rule of tickRules) {
    if (p.greaterThanOrEqualTo(rule.priceFrom)) applicable = rule;
    else break;
  }
  return applicable ? new Decimal(applicable.tickSize) : null;
};

/**
 * 価格を呼値刻みに丸める。
 * BUY は切り下げ（不利にしない方向）、SELL は切り上げ、未指定はそのまま。
 */
export const roundToTick = (
  price: Decimal.Value,
  instrument: Pick<Instrument, "tickRules">,
  side: OrderSide,
): string => {
  const tick = tickSizeFor(price, instrument.tickRules);
  if (!tick || tick.isZero()) return new Decimal(price).toString();
  const p = new Decimal(price);
  const units = p.dividedBy(tick);
  const rounded = side === "BUY" ? units.floor() : units.ceil();
  return rounded.times(tick).toString();
};

/** 数量が単元株の倍数か（端株を許さない場合の検証）。 */
export const isValidLot = (
  quantity: number,
  instrument: Pick<Instrument, "lotSize">,
): boolean => quantity > 0 && quantity % instrument.lotSize === 0;
