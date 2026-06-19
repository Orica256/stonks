import Decimal from "decimal.js";
import type {
  BacktestResult,
  BacktestRunner,
  Instrument,
  PriceBar,
  RunBacktestRequest,
  StrategyRule,
  Trade,
} from "@stonks/contracts";
import {
  InMemoryAccountStateProvider,
  InMemoryInstrumentProvider,
  InMemoryOrderRepository,
  StandardFeeModel,
  StandardTradingEngine,
  SlippageFillModel,
} from "@stonks/trading-engine";
import type { BacktestDataSource } from "./ports.js";
import { HistoricalPriceFeed } from "./price-feed.js";
import { compileWhen, type WhenEvaluator } from "./rule-evaluator.js";
import { computeMetrics, type EquitySample } from "./metrics.js";

const ACCOUNT_ID = "backtest";

interface CompiledRule {
  when: WhenEvaluator;
  action: StrategyRule["action"];
  sizing: StrategyRule["sizing"];
}

/** 各銘柄の保有状態（平均取得単価で実現損益を算出）。 */
interface PositionState {
  qty: number;
  avgCost: Decimal; // 1 株あたり取得原価
}

/**
 * ヒストリカル OHLCV にルールベース戦略を仮想時間で適用する BacktestRunner。
 *
 * 約定は trading-engine（StandardTradingEngine / Fee / Fill）を再利用し、
 * 指標・指標ベースのルール評価は analytics（rule-evaluator 経由）を再利用する。
 * 各バーは ts 昇順で順次供給し、その時点までの close 列のみで判断する（ルックアヘッド禁止）。
 */
export class HistoricalBacktestRunner implements BacktestRunner {
  constructor(private readonly data: BacktestDataSource) {}

  async run(req: RunBacktestRequest): Promise<BacktestResult> {
    const { strategy, range, initialCash } = req;
    const fromMs = new Date(range.from).getTime();
    const toMs = new Date(range.to).getTime();

    // universe 各銘柄の range 内バーを収集（ts 昇順を前提）。
    const instruments = new Map<string, Instrument>();
    const barsByInstrument = new Map<string, PriceBar[]>();
    const currencyByInstrument = new Map<string, "JPY" | "USD">();

    for (const id of strategy.universe) {
      const instrument = this.data.getInstrument(id);
      if (!instrument) continue;
      instruments.set(id, instrument);
      currencyByInstrument.set(id, instrument.currency);
      const bars = this.data
        .getBars(id)
        .filter((b) => {
          const t = new Date(b.ts).getTime();
          return t >= fromMs && t <= toMs;
        })
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      barsByInstrument.set(id, bars);
    }

    // 単一通貨前提（universe は同一通貨を想定。混在は範囲外）。
    const currency =
      currencyByInstrument.get(strategy.universe[0] ?? "") ?? "JPY";

    // 価格フィード（仮想時間）。
    const feed = new HistoricalPriceFeed(
      Object.fromEntries(
        [...barsByInstrument.entries()].map(([id, bars]) => [
          id,
          {
            currency: currencyByInstrument.get(id) ?? "JPY",
            points: bars.map((b) => ({
              ts: new Date(b.ts).getTime(),
              close: b.close,
            })),
          },
        ]),
      ),
    );

    // trading-engine 構築（in-memory ポート）。現金はランナー側でも追跡する。
    const orders = new InMemoryOrderRepository();
    const accountState = new InMemoryAccountStateProvider();
    const instrumentProvider = new InMemoryInstrumentProvider([
      ...instruments.values(),
    ]);
    accountState.setCash(ACCOUNT_ID, currency, initialCash);

    let seq = 0;
    const clock = { now: new Date(fromMs) };
    const engine = new StandardTradingEngine({
      orders,
      accountState,
      instruments: instrumentProvider,
      feeModel: new StandardFeeModel(),
      fillModel: new SlippageFillModel(),
      generateId: () => `bt_${seq++}`,
      clock: () => clock.now,
    });

    // ルールをコンパイル。
    const rules: CompiledRule[] = strategy.rules.map((r) => ({
      when: compileWhen(r.when),
      action: r.action,
      sizing: r.sizing,
    }));

    // ランナー側のポートフォリオ状態。
    let cash = new Decimal(initialCash);
    const positions = new Map<string, PositionState>();
    const closeIndex = new Map<string, number>(); // 銘柄ごとの現在バー index
    const closeSeries = new Map<string, number[]>();
    for (const [id, bars] of barsByInstrument) {
      closeSeries.set(
        id,
        bars.map((b) => Number(b.close)),
      );
    }

    const closedPnls: Decimal[] = [];
    const curve: EquitySample[] = [];

    // 全銘柄のバー ts を統合した仮想タイムライン（昇順・重複除去）。
    const timeline = [
      ...new Set(
        [...barsByInstrument.values()].flatMap((bars) =>
          bars.map((b) => new Date(b.ts).getTime()),
        ),
      ),
    ].sort((a, b) => a - b);

    for (const tMs of timeline) {
      const now = new Date(tMs);
      clock.now = now;
      feed.advanceTo(now);

      // 各銘柄: 現在の close index を更新し、シグナルを評価して発注する。
      for (const [id, bars] of barsByInstrument) {
        const idx = bars.findIndex((b) => new Date(b.ts).getTime() === tMs);
        if (idx < 0) continue;
        closeIndex.set(id, idx);
        const closes = closeSeries.get(id) ?? [];

        for (const rule of rules) {
          if (!rule.when(closes, idx)) continue;
          await this.placeRuleOrder({
            engine,
            accountState,
            instrument: instruments.get(id)!,
            rule,
            closes,
            idx,
            cash,
            positions,
            currency,
          });
        }
      }

      // この ts のオープン注文を評価して約定させる。
      const trades = await engine.evaluateOpenOrders({
        now,
        priceProvider: feed,
      });
      for (const trade of trades) {
        const result = this.applyTrade(trade, cash, positions);
        cash = result.cash;
        if (result.realizedPnl !== null) closedPnls.push(result.realizedPnl);
        // 約定後の現金・保有を engine の口座状態へ反映（次の SELL 事前チェック用）。
        accountState.setCash(ACCOUNT_ID, currency, cash.toString());
        accountState.setPosition(
          ACCOUNT_ID,
          trade.instrumentId,
          positions.get(trade.instrumentId)?.qty ?? 0,
        );
      }

      // エクイティ = 現金 + 保有時価（その時点の close）。
      const equity = this.markToMarket(cash, positions, closeIndex, closeSeries);
      curve.push({ ts: now.toISOString(), equity: equity.toString() });
    }

    const metrics = computeMetrics({
      initialEquity: initialCash,
      curve,
      closedPnls,
    });

    return {
      metrics,
      equityCurve: curve.map((p) => ({ ts: p.ts, equity: p.equity })),
    };
  }

  /** ルールから数量を決め、MARKET 注文を発注する（資金/保有不足は握りつぶす）。 */
  private async placeRuleOrder(args: {
    engine: StandardTradingEngine;
    accountState: InMemoryAccountStateProvider;
    instrument: Instrument;
    rule: CompiledRule;
    closes: number[];
    idx: number;
    cash: Decimal;
    positions: Map<string, PositionState>;
    currency: "JPY" | "USD";
  }): Promise<void> {
    const { engine, instrument, rule, closes, idx, cash, positions } = args;
    const price = closes[idx];
    if (price == null || price <= 0) return;

    const held = positions.get(instrument.id)?.qty ?? 0;
    const side = rule.action === "BUY" ? "BUY" : "SELL";

    let quantity: number;
    if (rule.action === "CLOSE") {
      if (held <= 0) return;
      quantity = held;
    } else if (rule.sizing.mode === "FIXED_QTY") {
      quantity = rule.sizing.value;
    } else {
      // EQUITY_PCT: 現金（買い）/ 保有評価（売り）に対する比率で株数を算出。
      const budget =
        side === "BUY"
          ? cash.times(rule.sizing.value)
          : new Decimal(held).times(price);
      quantity = Math.floor(budget.dividedBy(price).toNumber());
    }

    // 単元株に丸める。
    const lot = instrument.lotSize;
    quantity = Math.floor(quantity / lot) * lot;
    if (side === "SELL") quantity = Math.min(quantity, held);
    if (quantity <= 0) return;

    try {
      await engine.placeOrder({
        accountId: ACCOUNT_ID,
        instrumentId: instrument.id,
        side,
        type: "MARKET",
        quantity,
        timeInForce: "DAY",
      });
    } catch {
      // 資金/保有/単元の事前チェックで弾かれた場合はスキップ（過去データの縮退）。
    }
  }

  /** 約定をランナーの現金・保有へ反映し、SELL の実現損益を返す。 */
  private applyTrade(
    trade: Trade,
    cash: Decimal,
    positions: Map<string, PositionState>,
  ): { cash: Decimal; realizedPnl: Decimal | null } {
    const qty = trade.quantity;
    const price = new Decimal(trade.price);
    const fee = new Decimal(trade.fee);
    const gross = price.times(qty);
    const pos = positions.get(trade.instrumentId) ?? {
      qty: 0,
      avgCost: new Decimal(0),
    };

    if (trade.side === "BUY") {
      const newQty = pos.qty + qty;
      const newCost = pos.avgCost
        .times(pos.qty)
        .plus(gross)
        .dividedBy(newQty);
      positions.set(trade.instrumentId, { qty: newQty, avgCost: newCost });
      return { cash: cash.minus(gross).minus(fee), realizedPnl: null };
    }

    // SELL: 実現損益 = (約定額 - 取得原価) - 手数料。
    const costBasis = pos.avgCost.times(qty);
    const realized = gross.minus(costBasis).minus(fee);
    const remaining = pos.qty - qty;
    positions.set(trade.instrumentId, {
      qty: remaining,
      avgCost: remaining > 0 ? pos.avgCost : new Decimal(0),
    });
    return { cash: cash.plus(gross).minus(fee), realizedPnl: realized };
  }

  /** 現金 + 全保有の時価（その時点 close）でエクイティを算出。 */
  private markToMarket(
    cash: Decimal,
    positions: Map<string, PositionState>,
    closeIndex: Map<string, number>,
    closeSeries: Map<string, number[]>,
  ): Decimal {
    let equity = cash;
    for (const [id, pos] of positions) {
      if (pos.qty <= 0) continue;
      const idx = closeIndex.get(id);
      const closes = closeSeries.get(id);
      if (idx == null || !closes) continue;
      const px = closes[idx];
      if (px == null) continue;
      equity = equity.plus(new Decimal(px).times(pos.qty));
    }
    return equity;
  }
}
