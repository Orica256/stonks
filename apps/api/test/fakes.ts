import type {
  FxProvider,
  FxRate,
  Instrument,
  Market,
  MarketDataProvider,
  Money,
  PriceBar,
  PriceProvider,
  Quote,
} from "@stonks/contracts";

/**
 * テスト用のフェイク market-data（実 fetch・外部 API に依存しない）。
 * MarketDataProvider / PriceProvider / FxProvider を一体で満たし、
 * apps/api の MarketDataRegistry を置き換える。
 */
export class FakeMarketData
  implements MarketDataProvider, PriceProvider, FxProvider
{
  private prices = new Map<string, string>();
  private instruments = new Map<string, Instrument>();
  private bars = new Map<string, PriceBar[]>();
  fxRate = "150";

  setInstrument(i: Instrument): void {
    this.instruments.set(i.id, i);
  }

  setPrice(instrumentId: string, last: string): void {
    this.prices.set(instrumentId, last);
  }

  setBars(instrumentId: string, bars: PriceBar[]): void {
    this.bars.set(instrumentId, bars);
  }

  async searchInstruments(q: string, market?: Market): Promise<Instrument[]> {
    const ql = q.toLowerCase();
    return [...this.instruments.values()].filter(
      (i) =>
        (market ? i.market === market : true) &&
        (i.symbol.toLowerCase().includes(ql) ||
          i.name.toLowerCase().includes(ql) ||
          i.id.toLowerCase().includes(ql)),
    );
  }

  async getQuote(instrumentId: string): Promise<Quote> {
    const last = this.prices.get(instrumentId) ?? "0";
    return {
      instrumentId,
      last,
      ts: new Date().toISOString(),
      source: "fake",
    };
  }

  async getBars(req: { instrumentId: string }): Promise<PriceBar[]> {
    return this.bars.get(req.instrumentId) ?? [];
  }

  async getLatestPrice(instrumentId: string): Promise<Money> {
    const last = this.prices.get(instrumentId) ?? "0";
    const inst = this.instruments.get(instrumentId);
    return { amount: last, currency: inst?.currency ?? "JPY" };
  }

  async getRate(base: "USD", quote: "JPY"): Promise<FxRate> {
    return { base, quote, rate: this.fxRate, ts: new Date().toISOString() };
  }
}

/** EXCHANGE:SYMBOL を正準 ID とする銘柄を作るヘルパ。 */
export const makeInstrument = (over: Partial<Instrument> = {}): Instrument => ({
  id: "TSE:7203",
  symbol: "7203",
  exchange: "TSE",
  market: "JP",
  name: "Toyota",
  currency: "JPY",
  type: "STOCK",
  lotSize: 100,
  tickRules: [],
  isActive: true,
  ...over,
});
