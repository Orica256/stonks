import { describe, expect, it } from "vitest";
import { isDomainError } from "@stonks/contracts";
import type { Order, PlaceOrderCommand } from "@stonks/contracts";
import { StandardTradingEngine } from "./engine.js";
import { StandardFeeModel } from "./fee-model.js";
import { SlippageFillModel } from "./fill-model.js";
import {
  InMemoryAccountStateProvider,
  InMemoryInstrumentProvider,
  InMemoryOrderRepository,
} from "./in-memory.js";
import {
  FakePriceProvider,
  JP_INSTRUMENT,
  seqIdGenerator,
} from "./test-helpers.js";

/**
 * 複合注文（OCO / IFD / bracket）の発注とカスケード（Phase 5）。
 * spec §2.2 P2・docs/contracts-backlog.md「Phase 5 契約: 複合注文」。
 */

const ACCOUNT = "acc-1";
const T0 = new Date("2026-06-19T01:00:00Z");

interface Harness {
  engine: StandardTradingEngine;
  orders: InMemoryOrderRepository;
  state: InMemoryAccountStateProvider;
  prices: FakePriceProvider;
}

const makeHarness = (opts?: {
  positionJp?: number;
  now?: Date;
}): Harness => {
  const orders = new InMemoryOrderRepository();
  const state = new InMemoryAccountStateProvider();
  const instruments = new InMemoryInstrumentProvider([JP_INSTRUMENT]);
  const prices = new FakePriceProvider();

  state.setCash(ACCOUNT, "JPY", "100000000");
  if (opts?.positionJp !== undefined)
    state.setPosition(ACCOUNT, JP_INSTRUMENT.id, opts.positionJp);

  const engine = new StandardTradingEngine({
    orders,
    accountState: state,
    instruments,
    feeModel: new StandardFeeModel(),
    fillModel: new SlippageFillModel({ slippageRate: "0" }),
    generateId: seqIdGenerator(),
    clock: () => opts?.now ?? T0,
  });

  return { engine, orders, state, prices };
};

/** SELL LIMIT 脚（保有を売る。market>=limit で約定）。 */
const sellLimit = (limitPrice: string, quantity = 100): PlaceOrderCommand =>
  ({
    accountId: ACCOUNT,
    instrumentId: JP_INSTRUMENT.id,
    side: "SELL",
    type: "LIMIT",
    quantity,
    limitPrice,
    timeInForce: "GTC",
  }) as PlaceOrderCommand;

/** BUY LIMIT 脚（market<=limit で約定）。 */
const buyLimit = (limitPrice: string, quantity = 100): PlaceOrderCommand =>
  ({
    accountId: ACCOUNT,
    instrumentId: JP_INSTRUMENT.id,
    side: "BUY",
    type: "LIMIT",
    quantity,
    limitPrice,
    timeInForce: "GTC",
  }) as PlaceOrderCommand;

const byId = (orders: Order[], id: string): Order => {
  const o = orders.find((x) => x.id === id);
  if (!o) throw new Error(`order ${id} not found`);
  return o;
};

/** 配列要素を非 undefined で取り出す（noUncheckedIndexedAccess 下のテスト補助）。 */
const at = (orders: Order[], i: number): Order => {
  const o = orders[i];
  if (!o) throw new Error(`order at index ${i} not found`);
  return o;
};

describe("placeBracketOrder OCO", () => {
  it("links both legs with a shared linkGroupId, both ACTIVE", async () => {
    const { engine } = makeHarness({ positionJp: 100 });
    const placed = await engine.placeBracketOrder!({
      kind: "OCO",
      legs: [sellLimit("1000"), sellLimit("1500")],
    });
    expect(placed).toHaveLength(2);
    expect(at(placed, 0).linkGroupId).toBeDefined();
    expect(at(placed, 0).linkGroupId).toBe(at(placed, 1).linkGroupId);
    expect(placed.every((o) => o.linkType === "OCO")).toBe(true);
    expect(placed.every((o) => o.activation === "ACTIVE")).toBe(true);
    expect(placed.every((o) => o.status === "PENDING")).toBe(true);
  });

  it("one leg fills -> the other is CANCELLED", async () => {
    const { engine, orders, prices } = makeHarness({ positionJp: 100 });
    const placed = await engine.placeBracketOrder!({
      kind: "OCO",
      legs: [sellLimit("1000"), sellLimit("1500")],
    });
    // 市場 1000: 1 脚目（limit 1000）だけ約定条件を満たす。
    prices.set(JP_INSTRUMENT.id, "1000");
    const trades = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    expect(trades).toHaveLength(1);
    const all = orders.all();
    expect(byId(all, at(placed, 0).id).status).toBe("FILLED");
    expect(byId(all, at(placed, 1).id).status).toBe("CANCELLED");
  });

  it("rejects the whole group if a leg is invalid (no orders saved)", async () => {
    const { engine, orders } = makeHarness({ positionJp: 100 });
    // 2 脚目は数量が保有を超え INSUFFICIENT_POSITION で弾かれる。
    await expect(
      engine.placeBracketOrder!({
        kind: "OCO",
        legs: [sellLimit("1000"), sellLimit("1500", 200)],
      }),
    ).rejects.toSatisfy((e) => isDomainError(e));
    // どの脚も保存されていない（all-or-nothing。検証を全脚通過後にまとめて save）。
    expect(orders.all()).toHaveLength(0);
  });
});

describe("placeBracketOrder IFD", () => {
  it("parent ACTIVE, children WAITING with parentOrderId", async () => {
    const { engine } = makeHarness();
    const placed = await engine.placeBracketOrder!({
      kind: "IFD",
      parent: buyLimit("1000"),
      children: [sellLimit("1200")],
    });
    expect(placed).toHaveLength(2);
    const parent = at(placed, 0);
    const child = at(placed, 1);
    expect(parent.activation).toBe("ACTIVE");
    expect(parent.linkType).toBe("IFD");
    expect(parent.parentOrderId).toBeUndefined();
    expect(child.activation).toBe("WAITING");
    expect(child.linkType).toBe("IFD");
    expect(child.parentOrderId).toBe(parent.id);
  });

  it("WAITING child is excluded from evaluation until parent fills", async () => {
    const { engine, orders, prices } = makeHarness();
    const placed = await engine.placeBracketOrder!({
      kind: "IFD",
      parent: buyLimit("1000"),
      children: [sellLimit("1200")],
    });
    const parent = at(placed, 0);
    const child = at(placed, 1);
    // 市場 1200: 子(売り limit 1200)は条件を満たすが WAITING のため約定しない。
    // 親(買い limit 1000)は market>limit で未約定。
    prices.set(JP_INSTRUMENT.id, "1200");
    const trades = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    expect(trades).toHaveLength(0);
    const all = orders.all();
    expect(byId(all, parent.id).status).toBe("PENDING");
    expect(byId(all, child.id).status).toBe("PENDING");
    expect(byId(all, child.id).activation).toBe("WAITING");
  });

  it("parent fill activates the WAITING child (ACTIVE), then child can fill", async () => {
    const { engine, orders, prices } = makeHarness();
    const placed = await engine.placeBracketOrder!({
      kind: "IFD",
      parent: buyLimit("1000"),
      children: [sellLimit("1200")],
    });
    const parent = at(placed, 0);
    const child = at(placed, 1);

    // 市場 1000: 親(買い limit 1000)が約定 → 子が ACTIVE に発効。子(売り 1200)は未到達。
    prices.set(JP_INSTRUMENT.id, "1000");
    const t1 = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    expect(t1).toHaveLength(1);
    let all = orders.all();
    expect(byId(all, parent.id).status).toBe("FILLED");
    expect(byId(all, child.id).activation).toBe("ACTIVE");
    expect(byId(all, child.id).status).toBe("PENDING");

    // 市場 1300: 発効済みの子(売り limit 1200)が約定。
    prices.set(JP_INSTRUMENT.id, "1300");
    const t2 = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    expect(t2).toHaveLength(1);
    all = orders.all();
    expect(byId(all, child.id).status).toBe("FILLED");
  });

  it("cancelling the parent cascades CANCELLED to WAITING children", async () => {
    const { engine, orders } = makeHarness();
    const placed = await engine.placeBracketOrder!({
      kind: "IFD",
      parent: buyLimit("1000"),
      children: [sellLimit("1200"), sellLimit("1300")],
    });
    const parent = at(placed, 0);
    const c1 = at(placed, 1);
    const c2 = at(placed, 2);
    await engine.cancelOrder(parent.id);
    const all = orders.all();
    expect(byId(all, parent.id).status).toBe("CANCELLED");
    expect(byId(all, c1.id).status).toBe("CANCELLED");
    expect(byId(all, c2.id).status).toBe("CANCELLED");
  });
});

describe("placeBracketOrder BRACKET", () => {
  it("parent ACTIVE, two children WAITING sharing linkGroupId + parentOrderId", async () => {
    const { engine } = makeHarness();
    const placed = await engine.placeBracketOrder!({
      kind: "BRACKET",
      parent: buyLimit("1000"),
      children: [sellLimit("1200"), sellLimit("800")],
    });
    expect(placed).toHaveLength(3);
    const parent = at(placed, 0);
    const c1 = at(placed, 1);
    const c2 = at(placed, 2);
    expect(parent.activation).toBe("ACTIVE");
    expect(parent.linkType).toBe("IFD");
    expect(c1.activation).toBe("WAITING");
    expect(c2.activation).toBe("WAITING");
    expect(c1.linkType).toBe("OCO");
    expect(c2.linkType).toBe("OCO");
    expect(c1.linkGroupId).toBeDefined();
    expect(c1.linkGroupId).toBe(c2.linkGroupId);
    expect(c1.parentOrderId).toBe(parent.id);
    expect(c2.parentOrderId).toBe(parent.id);
  });

  it("parent fills -> both children ACTIVE; one child fills -> other CANCELLED", async () => {
    const { engine, orders, prices } = makeHarness();
    const placed = await engine.placeBracketOrder!({
      kind: "BRACKET",
      parent: buyLimit("1000"),
      // 利確: 売り limit 1200。損切: 売り STOP は省略し、ここでは売り limit 800（market>=800 で約定）。
      children: [sellLimit("1200"), sellLimit("800")],
    });
    const parent = at(placed, 0);
    const c1 = at(placed, 1);
    const c2 = at(placed, 2);

    // 親約定（市場 1000 で買い limit 1000 が約定）→ 子 2 本発効。
    prices.set(JP_INSTRUMENT.id, "1000");
    const t1 = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    expect(t1).toHaveLength(1);
    let all = orders.all();
    expect(byId(all, parent.id).status).toBe("FILLED");
    expect(byId(all, c1.id).activation).toBe("ACTIVE");
    expect(byId(all, c2.id).activation).toBe("ACTIVE");

    // 市場 1300: c1(売り limit 1200) が約定 → c2 は OCO で CANCELLED。
    // c2(売り limit 800) も 1300>=800 で約定条件は満たすが、OCO により取消が優先される。
    prices.set(JP_INSTRUMENT.id, "1300");
    const t2 = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    expect(t2).toHaveLength(1);
    all = orders.all();
    const c1f = byId(all, c1.id);
    const c2f = byId(all, c2.id);
    // ちょうど 1 本が FILLED、もう 1 本が CANCELLED。
    const statuses = [c1f.status, c2f.status].sort();
    expect(statuses).toEqual(["CANCELLED", "FILLED"]);
  });
});

describe("cancelOrderGroup", () => {
  it("cancels all open and WAITING members of a linkGroupId", async () => {
    const { engine, orders } = makeHarness({ positionJp: 100 });
    const placed = await engine.placeBracketOrder!({
      kind: "OCO",
      legs: [sellLimit("1000"), sellLimit("1500")],
    });
    const legA = at(placed, 0);
    const legB = at(placed, 1);
    const groupId = legA.linkGroupId!;
    const cancelled = await engine.cancelOrderGroup!(groupId);
    expect(cancelled).toHaveLength(2);
    expect(cancelled.every((o) => o.status === "CANCELLED")).toBe(true);
    const all = orders.all();
    expect(byId(all, legA.id).status).toBe("CANCELLED");
    expect(byId(all, legB.id).status).toBe("CANCELLED");
  });

  it("leaves already-filled members untouched (only open/WAITING cancelled)", async () => {
    const { engine, orders, prices } = makeHarness({ positionJp: 100 });
    const placed = await engine.placeBracketOrder!({
      kind: "OCO",
      legs: [sellLimit("1000"), sellLimit("1500")],
    });
    const legA = at(placed, 0);
    const legB = at(placed, 1);
    const groupId = legA.linkGroupId!;
    // 1 脚を約定させてから（他方は OCO で CANCELLED 済み）グループ取消。
    prices.set(JP_INSTRUMENT.id, "1000");
    await engine.evaluateOpenOrders({ now: T0, priceProvider: prices });
    const cancelled = await engine.cancelOrderGroup!(groupId);
    // 既に FILLED/CANCELLED の終端状態なので、追加で取消される注文は無い。
    expect(cancelled).toHaveLength(0);
    const all = orders.all();
    expect(byId(all, legA.id).status).toBe("FILLED");
    expect(byId(all, legB.id).status).toBe("CANCELLED");
  });
});
