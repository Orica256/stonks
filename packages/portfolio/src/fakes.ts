import type {
  FxProvider,
  FxRate,
  Money,
  PriceProvider,
} from "@stonks/contracts";

/** テスト用の固定価格 PriceProvider（market-data に依存しない）。 */
export class FakePriceProvider implements PriceProvider {
  constructor(private readonly prices: Record<string, Money>) {}
  async getLatestPrice(instrumentId: string): Promise<Money> {
    const p = this.prices[instrumentId];
    if (!p) throw new Error(`no fake price for ${instrumentId}`);
    return p;
  }
  setPrice(instrumentId: string, price: Money): void {
    this.prices[instrumentId] = price;
  }
}

/** テスト用の固定 USD/JPY レート FxProvider。 */
export class FakeFxProvider implements FxProvider {
  constructor(private readonly usdJpy: string) {}
  async getRate(base: "USD", quote: "JPY"): Promise<FxRate> {
    return {
      base,
      quote,
      rate: this.usdJpy,
      ts: "2026-06-19T00:00:00.000Z",
    };
  }
}
