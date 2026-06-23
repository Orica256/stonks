import type {
  Currency,
  Instrument,
  MarginPolicy,
  MarginPolicyProvider,
  Order,
} from "@stonks/contracts";
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

  async findByLinkGroupId(linkGroupId: string): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((o) => o.linkGroupId === linkGroupId)
      .map((o) => ({ ...o }));
  }

  async findByParentOrderId(parentOrderId: string): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((o) => o.parentOrderId === parentOrderId)
      .map((o) => ({ ...o }));
  }

  async listByAccount(accountId: string): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((o) => o.accountId === accountId)
      .map((o) => ({ ...o }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // createdAt 降順（新しい順）
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

  setCash(accountId: string, currency: Currency, amount: string): void {
    this.cash.set(`${accountId}:${currency}`, amount);
  }

  setPosition(accountId: string, instrumentId: string, quantity: number): void {
    this.positions.set(`${accountId}:${instrumentId}`, quantity);
  }

  async getAvailableCash(accountId: string, currency: Currency): Promise<string> {
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

/**
 * in-memory な MarginPolicyProvider（テスト・Phase 1 用）。
 * 登録済み銘柄はポリシーを返し、未登録は null（信用不可→ MARGIN 発注は拒否）。
 * Phase 2 で市場ルール/設定由来のアダプタに差し替える。
 */
export class InMemoryMarginPolicyProvider implements MarginPolicyProvider {
  private readonly policies = new Map<string, MarginPolicy>();

  constructor(initial: Record<string, MarginPolicy> = {}) {
    for (const [k, v] of Object.entries(initial)) this.policies.set(k, v);
  }

  set(instrumentId: string, policy: MarginPolicy): void {
    this.policies.set(instrumentId, policy);
  }

  async getMarginPolicy(instrumentId: string): Promise<MarginPolicy | null> {
    return this.policies.get(instrumentId) ?? null;
  }
}
