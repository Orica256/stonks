import type { Instrument, PriceBar } from "@stonks/contracts";

/**
 * バックテストの入力データソース（ヒストリカル）。
 *
 * 実 market-data を直接 import しない（spec §4.3）。呼び出し側が
 * ヒストリカル OHLCV と Instrument を供給する。順序は ts 昇順を前提。
 */
export interface BacktestDataSource {
  /** universe 内の各銘柄の Instrument 定義（単元・通貨・呼値）。 */
  getInstrument(instrumentId: string): Instrument | undefined;
  /** 指定銘柄の range 内 PriceBar 列（ts 昇順）。 */
  getBars(instrumentId: string): PriceBar[];
}
