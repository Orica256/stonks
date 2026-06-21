import Decimal from "decimal.js";
import {
  DEFAULT_CAPITAL_GAINS_TAX_RATE,
  type DecimalString,
  type Rate,
} from "@stonks/contracts";

/**
 * 譲渡益課税の「概算」計算（spec §2.3 P1。CLAUDE.md §7 免責の範囲）。
 *
 * 確定申告の正確計算ではなく、実現益（プラス分）に概算率を掛けただけの目安。
 * 損益通算・繰越控除・各種特例は行わない（損失は税額に反映しない簡略方針）。
 * 浮動小数を使わず decimal.js で計算し、結果は DecimalString で返す（CLAUDE.md §0）。
 */

/** 既定の概算譲渡益課税率（20.315%）を再エクスポート（呼び出し側の利便のため）。 */
export { DEFAULT_CAPITAL_GAINS_TAX_RATE };

/**
 * 実現益と税率から概算税額を求める。
 *
 * `estimatedTax = max(realizedGains, 0) × taxRate`（常に 0 以上）。
 * 損失（realizedGains < 0）は概算では税額 0 とする。
 *
 * @param realizedGains 対象期間の実現損益合計（DecimalString。損失は負）。
 * @param taxRate 適用する概算税率（既定 DEFAULT_CAPITAL_GAINS_TAX_RATE = 20.315%）。
 * @returns 概算税額（DecimalString。0 以上）。
 */
export const estimateCapitalGainsTax = (
  realizedGains: DecimalString,
  taxRate: Rate = DEFAULT_CAPITAL_GAINS_TAX_RATE,
): DecimalString => {
  const gains = new Decimal(realizedGains);
  const taxable = gains.isPositive() ? gains : new Decimal(0);
  return taxable.times(taxRate).toString();
};
