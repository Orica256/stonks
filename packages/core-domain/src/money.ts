import Decimal from "decimal.js";
import type { Currency, Money } from "@stonks/contracts";

/**
 * 金額演算ユーティリティ（CLAUDE.md §0: 浮動小数禁止）。
 * 内部は decimal.js、外部表現は Money({ amount: DecimalString, currency })。
 * 通貨混在の演算は実行時に拒否する（換算は FX 層の責務）。
 */

export const money = (amount: Decimal.Value, currency: Currency): Money => ({
  amount: new Decimal(amount).toString(),
  currency,
});

export const zero = (currency: Currency): Money => money(0, currency);

const assertSameCurrency = (a: Money, b: Money): void => {
  if (a.currency !== b.currency) {
    throw new Error(
      `currency mismatch: ${a.currency} vs ${b.currency} (convert via FX first)`,
    );
  }
};

export const add = (a: Money, b: Money): Money => {
  assertSameCurrency(a, b);
  return money(new Decimal(a.amount).plus(b.amount), a.currency);
};

export const sub = (a: Money, b: Money): Money => {
  assertSameCurrency(a, b);
  return money(new Decimal(a.amount).minus(b.amount), a.currency);
};

/** 金額 × 数量（無名の係数）。通貨は維持。 */
export const mul = (a: Money, factor: Decimal.Value): Money =>
  money(new Decimal(a.amount).times(factor), a.currency);

export const negate = (a: Money): Money =>
  money(new Decimal(a.amount).negated(), a.currency);

/** a<b: -1, a==b: 0, a>b: 1。 */
export const compare = (a: Money, b: Money): -1 | 0 | 1 => {
  assertSameCurrency(a, b);
  return new Decimal(a.amount).comparedTo(b.amount) as -1 | 0 | 1;
};

export const isNegative = (a: Money): boolean => new Decimal(a.amount).isNeg();

/** 単価 × 株数 を Money にする。 */
export const notional = (
  price: Decimal.Value,
  quantity: Decimal.Value,
  currency: Currency,
): Money => money(new Decimal(price).times(quantity), currency);
