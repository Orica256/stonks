import Decimal from "decimal.js";
import { Money } from "@stonks/core-domain";
import type {
  Currency,
  InterestAccrual,
  InterestAccrualType,
  MarginPolicy,
  MarginRequirement,
  OrderSide,
  PositionSide,
} from "@stonks/contracts";

/**
 * 信用取引（margin）の純粋な計算ユーティリティ（spec §2.2 P2）。
 *
 * 副作用を持たず、発注前の保証金所要額・日次の金利/貸株料を評価する。
 * 約定ロジックと同様 backtest からも再利用できるよう純関数に保つ
 * （CLAUDE.md §0: 浮動小数禁止。すべて Decimal で計算し DecimalString で返す）。
 */

/** 1 年の日数（日割り金利の分母。実務の慣行に合わせ 365 固定）。 */
export const DAYS_PER_YEAR = 365;

/**
 * 発注前の必要保証金を求める（MarginRequirement）。
 *
 * notional = quantity × price、requiredMargin = notional × initialMarginRate。
 * いずれも純粋な代金として保持し、充足判定は Money 比較で行う。
 */
export const computeMarginRequirement = (input: {
  quantity: number;
  price: string;
  policy: MarginPolicy;
  currency: Currency;
}): MarginRequirement => {
  const { quantity, price, policy, currency } = input;
  const notional = new Decimal(price).times(quantity);
  const requiredMargin = notional.times(policy.initialMarginRate);
  return {
    notional: notional.toString(),
    requiredMargin: requiredMargin.toString(),
    initialMarginRate: policy.initialMarginRate,
    currency,
  };
};

/**
 * 信用建ての建玉サイドを決める。
 * BUY × MARGIN = 買い建て（LONG）、SELL × MARGIN = 新規売り建て（SHORT）。
 */
export const marginPositionSide = (orderSide: OrderSide): PositionSide =>
  orderSide === "BUY" ? "LONG" : "SHORT";

/**
 * 建玉サイドに応じて適用する年利を選ぶ。
 * - LONG（買い建て）: annualInterestRate（買い建て金利）。
 * - SHORT（売り建て）: annualBorrowRate があれば貸株料、無ければ annualInterestRate。
 */
export const annualRateForSide = (
  side: PositionSide,
  policy: MarginPolicy,
): string =>
  side === "SHORT"
    ? policy.annualBorrowRate ?? policy.annualInterestRate
    : policy.annualInterestRate;

/** 建玉サイドに対応する金利/貸株料の種別。 */
export const accrualTypeForSide = (side: PositionSide): InterestAccrualType =>
  side === "SHORT" ? "BORROW_FEE" : "INTEREST";

/** 経過日数を UTC 日付差で求める（負値は 0 に丸める）。 */
export const daysBetween = (from: Date, to: Date): number => {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor(ms / dayMs);
};

/**
 * 日割りの金利/貸株料を 1 件算出する（純粋関数。spec §5.1 INTEREST/BORROW_FEE）。
 *
 * amount = principal × annualRate × days / 365。費用なので**負の現金移動**として返す
 * （CashLedgerEntry(INTEREST|BORROW_FEE) の amount にそのまま載せられる符号）。
 *
 * 計上の永続化（CashLedger への記帳・Position.margin.accruedInterest /
 * lastAccruedAt の更新）は portfolio の責務。ここでは契約形の発生記録だけを返し、
 * 状態は持たない（責務分界: 算出=trading-engine / 反映=portfolio）。
 */
export const computeInterestAccrual = (input: {
  id: string;
  accountId: string;
  positionId: string;
  instrumentId: string;
  side: PositionSide;
  /** 金利計算の基準額（建玉の総代金）。 */
  principal: string;
  annualRate: string;
  /** 計上対象日数（日割り）。負値は 0 に丸める。 */
  days: number;
  currency: Currency;
  /** 計上対象日（UTC）。 */
  accruedAt: Date;
}): InterestAccrual => {
  const days = Math.max(0, Math.trunc(input.days));
  const gross = new Decimal(input.principal)
    .times(input.annualRate)
    .times(days)
    .dividedBy(DAYS_PER_YEAR);
  // 費用は負の現金移動。通貨最小単位に丸める（切り上げ＝利用者不利側で保守的）。
  const decimals = input.currency === "USD" ? 2 : 0;
  const amount = gross.toDecimalPlaces(decimals, Decimal.ROUND_UP).negated();
  return {
    id: input.id,
    accountId: input.accountId,
    positionId: input.positionId,
    instrumentId: input.instrumentId,
    type: accrualTypeForSide(input.side),
    principal: new Decimal(input.principal).toString(),
    annualRate: input.annualRate,
    days,
    amount: amount.toString(),
    currency: input.currency,
    accruedAt: input.accruedAt.toISOString(),
  };
};

/** requiredMargin ≤ available かを Money 比較で判定する。 */
export const hasSufficientMargin = (
  required: string,
  available: string,
  currency: Currency,
): boolean =>
  Money.compare(
    Money.money(required, currency),
    Money.money(available, currency),
  ) <= 0;
