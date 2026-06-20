import type {
  AgentProfile,
  EquityPoint,
  Money,
  Order,
  PlaceOrderCommand,
  PortfolioService,
  PortfolioSummary,
  PositionView,
  PriceProvider,
  RealizedPnl,
  Trade,
  TradingEngine,
} from "@stonks/contracts";
import type { AgentProfileProvider } from "./agent-trading-service.js";

/**
 * テスト用フェイク群（contracts の IF 実装）。
 * 実ドメイン（trading-engine / portfolio / market-data）に依存せず、
 * agent-trader のロジックのみを検証するために注入する（CLAUDE.md §3）。
 */

/**
 * 価格 PriceProvider のフェイク。
 * 既定は固定価格。`at` 依存の価格が必要なテストでは ISO 文字列キーの
 * 時点別オーバーライド（atPrices）を指定できる（ルックアヘッド検証用）。
 */
export class FakePriceProvider implements PriceProvider {
  constructor(
    private readonly prices: Record<string, Money>,
    private readonly atPrices: Record<string, Record<string, Money>> = {},
  ) {}
  async getLatestPrice(instrumentId: string, at?: Date): Promise<Money> {
    if (at) {
      const p = this.atPrices[at.toISOString()]?.[instrumentId];
      if (p) return p;
    }
    const p = this.prices[instrumentId];
    if (!p) throw new Error(`no fake price for ${instrumentId}`);
    return p;
  }
  setPrice(instrumentId: string, price: Money): void {
    this.prices[instrumentId] = price;
  }
}

/** 発注を記録するだけの TradingEngine。連番 id で Order を返す。 */
export class FakeTradingEngine implements TradingEngine {
  readonly placed: PlaceOrderCommand[] = [];
  readonly cancelled: string[] = [];
  private seq = 0;
  /** cancelOrder で投げさせたい場合に true。 */
  failCancel = false;

  async placeOrder(cmd: PlaceOrderCommand): Promise<Order> {
    this.placed.push(cmd);
    const id = `o-${++this.seq}`;
    const now = "2026-06-19T00:00:00.000Z";
    return {
      id,
      accountId: cmd.accountId,
      instrumentId: cmd.instrumentId,
      side: cmd.side,
      type: cmd.type,
      quantity: cmd.quantity,
      filledQuantity: 0,
      ...(cmd.limitPrice !== undefined ? { limitPrice: cmd.limitPrice } : {}),
      ...(cmd.stopPrice !== undefined ? { stopPrice: cmd.stopPrice } : {}),
      timeInForce: cmd.timeInForce,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
    };
  }

  async cancelOrder(orderId: string): Promise<Order> {
    if (this.failCancel) throw new Error(`cannot cancel ${orderId}`);
    this.cancelled.push(orderId);
    const now = "2026-06-19T00:00:00.000Z";
    return {
      id: orderId,
      accountId: "acc",
      instrumentId: "i-1",
      side: "BUY",
      type: "MARKET",
      quantity: 1,
      filledQuantity: 0,
      timeInForce: "DAY",
      status: "CANCELLED",
      createdAt: now,
      updatedAt: now,
    };
  }

  async evaluateOpenOrders(): Promise<Trade[]> {
    return [];
  }
}

export interface FakePortfolioState {
  summary: PortfolioSummary;
  positions?: PositionView[];
  history?: EquityPoint[];
  trades?: Trade[];
  realizedPnl?: RealizedPnl[];
}

/** 注入したスナップショットを返すだけの PortfolioService。 */
export class FakePortfolioService implements PortfolioService {
  constructor(private state: FakePortfolioState) {}

  set(state: FakePortfolioState): void {
    this.state = state;
  }

  async applyTrade(): Promise<void> {
    /* no-op */
  }
  async deposit(): Promise<void> {
    /* no-op */
  }
  async withdraw(): Promise<void> {
    /* no-op */
  }
  async getPositions(): Promise<PositionView[]> {
    return this.state.positions ?? [];
  }
  async getSummary(): Promise<PortfolioSummary> {
    return this.state.summary;
  }
  async getTrades(): Promise<Trade[]> {
    return this.state.trades ?? [];
  }
  async getRealizedPnl(): Promise<RealizedPnl[]> {
    return this.state.realizedPnl ?? [];
  }
  async getHistory(
    _accountId: string,
    range: { from: Date; to: Date },
  ): Promise<EquityPoint[]> {
    const from = range.from.getTime();
    const to = range.to.getTime();
    return (this.state.history ?? []).filter((p) => {
      const t = new Date(p.ts).getTime();
      return t >= from && t <= to;
    });
  }
}

/** 固定の AgentProfile を返す provider。 */
export class FakeAgentProfileProvider implements AgentProfileProvider {
  constructor(private readonly profiles: Record<string, AgentProfile>) {}
  async getProfile(agentProfileId: string): Promise<AgentProfile | null> {
    return this.profiles[agentProfileId] ?? null;
  }
}
