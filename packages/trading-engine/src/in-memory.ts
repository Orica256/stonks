import type { Instrument, Order } from "@stonks/contracts";
import type {
  AccountStateProvider,
  InstrumentProvider,
  OrderRepository,
} from "./ports.js";

/**
 * ポートの in-memory 実装（テスト・Phase 1 用）。
 * Phase 2 で db / portfolio 由来のアダプタに差し替える。
 */

const OPEN_STATUSES = new Set<Order["status"]>([
  "PENDING",
  "PARTIALLY_FILLED",
]);

/** in-memory な注文リポジトリ。 */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>();

  async save(order: Order): Promise<void> {
    this.orders.set(order.id, { ...order });
  }

  async findById(orderId: string): Promise<Order | null> {
    const o = this.orders.get(orderId);
    return o ? { ...o } : null;
  }

  async findOpen(): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((o) => OPEN_STATUSES.has(o.status))
      .map((o) => ({ ...o }));
  }

  async update(order: Order): Promise<void> {
    this.orders.set(order.id, { ...order });
  }

  /** テスト補助: 全注文のスナップショット。 */
  all(): Order[] {
    return [...this.orders.values()].map((o) => ({ ...o }));
  }
}

/** in-memory な口座状態プロバイダ（現金は通貨別、保有は銘柄別）。 */
export class InMemoryAccountStateProvider implements AccountStateProvider {
  private readonly cash = new Map<string, string>(); // `${accountId}:${currency}` -> amount
  private readonly positions = new Map<string, number>(); // `${accountId}:${instrumentId}` -> qty

  setCash(accountId: string, currency: string, amount: string): void {
    this.cash.set(`${accountId}:${currency}`, amount);
  }

  setPosition(accountId: string, instrumentId: string, quantity: number): void {
    this.positions.set(`${accountId}:${instrumentId}`, quantity);
  }

  async getAvailableCash(accountId: string, currency: string): Promise<string> {
    return this.cash.get(`${accountId}:${currency}`) ?? "0";
  }

  async getPositionQuantity(
    accountId: string,
    instrumentId: string,
  ): Promise<number> {
    return this.positions.get(`${accountId}:${instrumentId}`) ?? 0;
  }
}

/** in-memory な Instrument プロバイダ。 */
export class InMemoryInstrumentProvider implements InstrumentProvider {
  private readonly instruments = new Map<string, Instrument>();

  constructor(instruments: Instrument[] = []) {
    for (const i of instruments) this.instruments.set(i.id, i);
  }

  add(instrument: Instrument): void {
    this.instruments.set(instrument.id, instrument);
  }

  async getById(instrumentId: string): Promise<Instrument | null> {
    return this.instruments.get(instrumentId) ?? null;
  }
}
