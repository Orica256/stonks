/**
 * @stonks/analytics — テクニカル指標計算（spec §2.4, §6.4）。
 *
 * `IndicatorService` の純粋関数実装。OHLCV（PriceBar 配列）を入力に
 * SMA/EMA/RSI/MACD/BBANDS/VOLUME の系列を返す。副作用なし・DB/ネットワーク非依存。
 * 型は @stonks/contracts に従う（CLAUDE.md §0 横依存禁止）。
 */
export { indicatorService, createIndicatorService } from "./service.js";
export {
  sma,
  ema,
  rsi,
  macd,
  bbands,
  type MacdResult,
  type BBandsResult,
} from "./indicators.js";
