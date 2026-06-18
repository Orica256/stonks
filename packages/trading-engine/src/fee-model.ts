import Decimal from "decimal.js";
import { Money } from "@stonks/core-domain";
import type { FeeModel, Instrument, Money as MoneyType, Order } from "@stonks/contracts";

/**
 * 市場別の現実的な手数料モデル（spec §2.2・§6.2）。
 *
 * - JP（東証）: 約定代金に応じた段階制手数料（国内ネット証券の現物「スタンダード」系を模した近似）。
 * - US: 株数ベースのコミッション + 売却時の規制手数料（SEC/TAF 風の近似）。最低額あり。
 *
 * 金額はすべて Decimal で計算し、最後に通貨へ丸めて Money 文字列にする
 * （JPY は整数円、USD は 2 桁セント）。
 */

/** JP 現物の段階制手数料: 約定代金 <= threshold で fee（円）。昇順。 */
export interface JpFeeTier {
  upTo: string; // DecimalString（約定代金の上限・以下）。最後の段は Infinity 相当に Number.MAX 扱い
  fee: string; // DecimalString（円・税抜）
}

export interface FeeModelConfig {
  /** JP の段階制テーブル（昇順）。最後の段は十分大きい upTo を置く。 */
  jpTiers: JpFeeTier[];
  /** JP 消費税率（例 "0.10"）。 */
  jpTaxRate: string;
  /** US の 1 株あたりコミッション（DecimalString, USD）。 */
  usPerShare: string;
  /** US の最低コミッション（DecimalString, USD）。 */
  usMinCommission: string;
  /** US の最大コミッション（約定代金比の上限。DecimalString の比率, 例 "0.005"）。 */
  usMaxCommissionRate: string;
  /** US 売却時の規制手数料率（約定代金比。SEC/TAF 近似, DecimalString）。 */
  usSellRegulatoryRate: string;
}

/** 既定値（無料運用・シミュレーションとして現実的な近似）。 */
export const DEFAULT_FEE_CONFIG: FeeModelConfig = {
  // 国内ネット証券の現物「都度プラン」を模した近似（税抜）。
  jpTiers: [
    { upTo: "50000", fee: "55" },
    { upTo: "100000", fee: "99" },
    { upTo: "200000", fee: "115" },
    { upTo: "500000", fee: "275" },
    { upTo: "1000000", fee: "535" },
    { upTo: "1500000", fee: "640" },
    { upTo: "30000000", fee: "1013" },
    { upTo: "1000000000000", fee: "1070" },
  ],
  jpTaxRate: "0.10",
  usPerShare: "0.005",
  usMinCommission: "1.00",
  usMaxCommissionRate: "0.005",
  usSellRegulatoryRate: "0.0000278",
};

/** 通貨ごとの最小単位の桁数（丸め用）。 */
const decimalsForCurrency = (currency: string): number =>
  currency === "USD" ? 2 : 0;

export class StandardFeeModel implements FeeModel {
  private readonly config: FeeModelConfig;

  constructor(config: FeeModelConfig = DEFAULT_FEE_CONFIG) {
    this.config = config;
  }

  calculate(input: {
    instrument: Instrument;
    side: Order["side"];
    quantity: number;
    price: string;
  }): { fee: MoneyType } {
    const { instrument, side, quantity, price } = input;
    const notional = new Decimal(price).times(quantity);

    const raw =
      instrument.market === "JP"
        ? this.calcJp(notional)
        : this.calcUs(notional, quantity, side);

    // 通貨の最小単位に丸める（手数料は切り上げ＝利用者不利側で保守的）。
    const decimals = decimalsForCurrency(instrument.currency);
    const rounded = raw.toDecimalPlaces(decimals, Decimal.ROUND_UP);
    return { fee: Money.money(rounded, instrument.currency) };
  }

  private calcJp(notional: Decimal): Decimal {
    const tier =
      this.config.jpTiers.find((t) => notional.lessThanOrEqualTo(t.upTo)) ??
      this.config.jpTiers[this.config.jpTiers.length - 1];
    const base = new Decimal(tier ? tier.fee : "0");
    const withTax = base.times(new Decimal(1).plus(this.config.jpTaxRate));
    return withTax;
  }

  private calcUs(
    notional: Decimal,
    quantity: number,
    side: Order["side"],
  ): Decimal {
    let commission = new Decimal(this.config.usPerShare).times(quantity);
    const min = new Decimal(this.config.usMinCommission);
    if (commission.lessThan(min)) commission = min;
    const cap = notional.times(this.config.usMaxCommissionRate);
    if (commission.greaterThan(cap) && cap.greaterThan(0)) commission = cap;

    // 規制手数料は売却時のみ（SEC fee 風）。
    if (side === "SELL") {
      commission = commission.plus(
        notional.times(this.config.usSellRegulatoryRate),
      );
    }
    return commission;
  }
}
