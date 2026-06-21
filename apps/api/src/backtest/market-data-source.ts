import type {
  Instrument,
  MarketDataProvider,
  PriceBar,
  RunBacktestRequest,
} from "@stonks/contracts";
import type { InstrumentProvider } from "@stonks/trading-engine";
import {
  HistoricalBacktestRunner,
  InMemoryDataSource,
  type BacktestDataSource,
} from "@stonks/backtest";

/**
 * apps/api 側の backtest 結線アダプタ（spec §6.5 / §4.3）。
 *
 * `BacktestDataSource` は同期 IF（getInstrument/getBars）だが、market-data /
 * trading-engine のプロバイダは非同期。リクエストの universe/range に対して
 * 必要なヒストリカル OHLCV と Instrument を**前もって**取得し、
 * `InMemoryDataSource` に流し込んでから `HistoricalBacktestRunner` を回す。
 *
 * これにより backtest パッケージは実 market-data を直接 import せず、
 * apps/api が contracts IF 経由でデータを供給する（依存性逆転）。
 */
export class MarketDataBacktestRunnerFactory {
  constructor(
    private readonly market: MarketDataProvider,
    private readonly instruments: InstrumentProvider,
  ) {}

  /** universe/range のヒストリカルデータを取得し、決定論的にバックテストを実行する。 */
  async buildDataSource(req: RunBacktestRequest): Promise<BacktestDataSource> {
    const { strategy, range } = req;
    const source = new InMemoryDataSource();

    // universe 各銘柄の Instrument 定義とバーを取得（重複 id は一度だけ）。
    const seen = new Set<string>();
    for (const instrumentId of strategy.universe) {
      if (seen.has(instrumentId)) continue;
      seen.add(instrumentId);

      const instrument = await this.instruments.getById(instrumentId);
      if (instrument) source.addInstrument(instrument as Instrument);

      const bars: PriceBar[] = await this.market.getBars({
        instrumentId,
        timeframe: strategy.timeframe,
        from: range.from,
        to: range.to,
      });
      // ts 昇順を runner が前提とするため、ここで整える。
      source.setBars(
        instrumentId,
        [...bars].sort(
          (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
        ),
      );
    }

    return source;
  }

  /** リクエストからデータソースを束ね、BacktestRunner を実行して結果を返す。 */
  async run(req: RunBacktestRequest) {
    const source = await this.buildDataSource(req);
    return new HistoricalBacktestRunner(source).run(req);
  }
}
