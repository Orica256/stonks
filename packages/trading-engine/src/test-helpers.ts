import type {
  Instrument,
  MarginPolicy,
  MarginPolicyProvider,
  Money,
  PriceProvider,
} from "@stonks/contracts";

/** テスト用の銘柄（東証トヨタ風: lot=100, tick あり）。 */
export const JP_INSTRUMENT: Instrument = {
  id: "jp-7203",
  symbol: "7203",
  exchange: "TSE",
  market: "JP",
  name: "Toyota",
  currency: "JPY",
  type: "STOCK",
  lotSize: 100,
  tickRules: [
    { priceFrom: "0", tickSize: "0.5" },
    { priceFrom: "1000", tickSize: "1" },
    { priceFrom: "3000", tickSize: "5" },
  ],
  isActive: true,
};

/** テスト用の銘柄（米国 AAPL 風: lot=1, tick なし）。 */
export const US_INSTRUMENT: Instrument = {
  id: "us-aapl",
  symbol: "AAPL",
  exchange: "NASDAQ",
  market: "US",
  name: "Apple",
  currency: "USD",
  type: "STOCK",
  lotSize: 1,
  tickRules: [],
  isActive: true,
};

/**
 * 固定/可変価格を返すフェイク PriceProvider。
 * market-data に依存せず、価格を直接注入してテストする。
 */
export class FakePriceProvider implements PriceProvider {
  private readonly prices = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.prices.set(k, v);
  }

  set(instrumentId: string, price: string): void {
    this.prices.set(instrumentId, price);
  }

  async getLatestPrice(instrumentId: string): Promise<Money> {
    const amount = this.prices.get(instrumentId);
    if (amount === undefined) {
      throw new Error(`no fake price for ${instrumentId}`);
    }
    const currency = instrumentId.startsWith("us-") ? "USD" : "JPY";
    return { amount, currency };
  }
}

/** 連番 ID 採番（決定的テスト用）。 */
export const seqIdGenerator = (): (() => string) => {
  let n = 0;
  return () => `id-${++n}`;
};

/** JP 信用の規定ポリシー風（保証金 30%/維持 20%・買い建て金利 2.8%・貸株料 1.1%）。 */
export const JP_MARGIN_POLICY: MarginPolicy = {
  initialMarginRate: "0.30",
  maintenanceMarginRate: "0.20",
  annualInterestRate: "0.028",
  annualBorrowRate: "0.011",
};

/**
 * フェイクの MarginPolicyProvider。
 * 登録済み銘柄はポリシーを返し、未登録は null（信用不可）を返す。
 */
export class FakeMarginPolicyProvider implements MarginPolicyProvider {
  private readonly policies = new Map<string, MarginPolicy>();

  constructor(initial: Record<string, MarginPolicy> = {}) {
    for (const [k, v] of Object.entries(initial)) this.policies.set(k, v);
  }

  set(instrumentId: string, policy: MarginPolicy): void {
    this.policies.set(instrumentId, policy);
  }

  async getMarginPolicy(instrumentId: string): Promise<MarginPolicy | null> {
    return this.policies.get(instrumentId) ?? null;
  }
}
