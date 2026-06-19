import type { Instrument, PriceBar } from "@stonks/contracts";
import type { BacktestDataSource } from "./ports.js";

/**
 * in-memory なヒストリカルデータソース（テスト・オフライン用）。
 * 実運用では market-data からエクスポートしたバーを流し込むアダプタに差し替える。
 */
export class InMemoryDataSource implements BacktestDataSource {
  private readonly instruments = new Map<string, Instrument>();
  private readonly bars = new Map<string, PriceBar[]>();

  constructor(
    instruments: Instrument[] = [],
    bars: Record<string, PriceBar[]> = {},
  ) {
    for (const i of instruments) this.instruments.set(i.id, i);
    for (const [id, b] of Object.entries(bars)) this.bars.set(id, b);
  }

  addInstrument(instrument: Instrument): void {
    this.instruments.set(instrument.id, instrument);
  }

  setBars(instrumentId: string, bars: PriceBar[]): void {
    this.bars.set(instrumentId, bars);
  }

  getInstrument(instrumentId: string): Instrument | undefined {
    return this.instruments.get(instrumentId);
  }

  getBars(instrumentId: string): PriceBar[] {
    return this.bars.get(instrumentId) ?? [];
  }
}
