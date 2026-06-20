import type {
  FxRate,
  GetBarsRequest,
  Instrument,
  Market,
  PriceBar,
  Quote,
} from "@stonks/contracts";
import { DomainError } from "@stonks/contracts";
import type { MarketDataPort } from "./handlers.js";
import type { IngestionRepository } from "./repository.js";

/**
 * テスト用フェイク。実 Redis・実外部 API・実 DB に依存せず、
 * contracts の IF 実装に対してハンドラ/スケジューラを検証する（CLAUDE.md §3）。
 */

/** 設定可能なフェイク MarketDataPort。呼び出しを記録し、固定値を返す。 */
export class FakeMarketData implements MarketDataPort {
  public quoteCalls: string[] = [];
  public barsCalls: GetBarsRequest[] = [];
  public rateCalls: number = 0;

  constructor(
    private readonly fixtures: {
      quote?: Quote;
      bars?: PriceBar[];
      rate?: FxRate;
      throwOn?: "quote" | "bars" | "rate";
    } = {},
  ) {}

  async searchInstruments(_q: string, _market?: Market): Promise<Instrument[]> {
    return [];
  }

  async getQuote(instrumentId: string): Promise<Quote> {
    this.quoteCalls.push(instrumentId);
    if (this.fixtures.throwOn === "quote") {
      throw new DomainError("PROVIDER_UNAVAILABLE", "fake quote failure");
    }
    return (
      this.fixtures.quote ?? {
        instrumentId,
        last: "100",
        ts: "2026-06-20T00:00:00.000Z",
        source: "fake",
      }
    );
  }

  async getBars(req: GetBarsRequest): Promise<PriceBar[]> {
    this.barsCalls.push(req);
    if (this.fixtures.throwOn === "bars") {
      throw new DomainError("PROVIDER_UNAVAILABLE", "fake bars failure");
    }
    return this.fixtures.bars ?? [];
  }

  async getRate(base: "USD", quote: "JPY", _at?: Date): Promise<FxRate> {
    this.rateCalls += 1;
    if (this.fixtures.throwOn === "rate") {
      throw new DomainError("PROVIDER_UNAVAILABLE", "fake rate failure");
    }
    return (
      this.fixtures.rate ?? {
        base,
        quote,
        rate: "150.0",
        ts: "2026-06-20T00:00:00.000Z",
      }
    );
  }
}

/** 保存内容を配列に積む in-memory リポジトリ。 */
export class FakeRepository implements IngestionRepository {
  public instruments: Instrument[] = [];
  public bars: PriceBar[] = [];
  public quotes: Quote[] = [];
  public fxRates: FxRate[] = [];

  async upsertInstrument(instrument: Instrument): Promise<void> {
    this.instruments.push(instrument);
  }

  async saveBars(bars: PriceBar[]): Promise<number> {
    this.bars.push(...bars);
    return bars.length;
  }

  async saveQuote(quote: Quote): Promise<void> {
    this.quotes.push(quote);
  }

  async saveFxRate(rate: FxRate): Promise<void> {
    this.fxRates.push(rate);
  }
}
