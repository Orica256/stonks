/**
 * @stonks/trading-engine — 注文ライフサイクル・約定シミュレーション・手数料計算。
 *
 * 公開契約（TradingEngine / FeeModel / FillModel）は @stonks/contracts に準拠する。
 * 価格は PriceProvider IF 経由でのみ取得し market-data を直接 import しない（spec §6.2・§4.3）。
 */
export { StandardTradingEngine } from "./engine.js";
export type { TradingEngineDeps, LiquidityModel } from "./engine.js";

export {
  StandardFeeModel,
  DEFAULT_FEE_CONFIG,
} from "./fee-model.js";
export type { FeeModelConfig, JpFeeTier } from "./fee-model.js";

export { SlippageFillModel, DEFAULT_FILL_CONFIG } from "./fill-model.js";
export type { FillModelConfig } from "./fill-model.js";

export type {
  OrderRepository,
  AccountStateProvider,
  InstrumentProvider,
} from "./ports.js";

export {
  InMemoryOrderRepository,
  InMemoryAccountStateProvider,
  InMemoryInstrumentProvider,
} from "./in-memory.js";
