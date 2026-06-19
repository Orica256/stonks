import { beforeEach, describe, expect, it } from "vitest";
import { isDomainError, Order, Trade } from "@stonks/contracts";
import type { PlaceOrderCommand } from "@stonks/contracts";
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
  US_INSTRUMENT,
} from "./test-helpers.js";

const ACCOUNT = "acc-1";
const T0 = new Date("2026-06-19T01:00:00Z");

interface Harness {
  engine: StandardTradingEngine;
  orders: InMemoryOrderRepository;
  state: InMemoryAccountStateProvider;
  prices: FakePriceProvider;
}

const makeHarness = (opts?: {
  cashJpy?: string;
  cashUsd?: string;
  positionJp?: number;
  positionUs?: number;
  noSlippage?: boolean;
  liquidityCap?: number;
  now?: Date;
}): Harness => {
  const orders = new InMemoryOrderRepository();
  const state = new InMemoryAccountStateProvider();
  const instruments = new InMemoryInstrumentProvider([
    JP_INSTRUMENT,
    US_INSTRUMENT,
  ]);
  const prices = new FakePriceProvider();

  state.setCash(ACCOUNT, "JPY", opts?.cashJpy ?? "100000000");
  state.setCash(ACCOUNT, "USD", opts?.cashUsd ?? "1000000");
  if (opts?.positionJp !== undefined)
    state.setPosition(ACCOUNT, JP_INSTRUMENT.id, opts.positionJp);
  if (opts?.positionUs !== undefined)
    state.setPosition(ACCOUNT, US_INSTRUMENT.id, opts.positionUs);

  const engine = new StandardTradingEngine({
    orders,
    accountState: state,
    instruments,
    feeModel: new StandardFeeModel(),
    fillModel: new SlippageFillModel(
      opts?.noSlippage ? { slippageRate: "0" } : undefined,
    ),
    ...(opts?.liquidityCap !== undefined
      ? {
          liquidity: {
            maxFillQuantity: () => opts.liquidityCap as number,
          },
        }
      : {}),
    generateId: seqIdGenerator(),
    clock: () => opts?.now ?? T0,
  });

  return { engine, orders, state, prices };
};

const cmd = (over: Partial<PlaceOrderCommand>): PlaceOrderCommand =>
  ({
    accountId: ACCOUNT,
    instrumentId: JP_INSTRUMENT.id,
    side: "BUY",
    type: "MARKET",
    quantity: 100,
    timeInForce: "DAY",
    ...over,
  }) as PlaceOrderCommand;

describe("placeOrder validation & pre-checks", () => {
  it("accepts a valid MARKET buy as PENDING", async () => {
    const { engine } = makeHarness();
    const order = await engine.placeOrder(cmd({}));
    expect(order.status).toBe("PENDING");
    expect(order.filledQuantity).toBe(0);
    expect(Order.safeParse(order).success).toBe(true);
  });

  it("rejects non-lot quantity (JP lotSize=100)", async () => {
    const { engine } = makeHarness();
    await expect(engine.placeOrder(cmd({ quantity: 150 }))).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "VALIDATION",
    );
  });

  it("rounds limit price to tick (SELL rounds up)", async () => {
    const { engine } = makeHarness({ positionJp: 100 });
    // price 1003.4 in band tick=1 -> SELL ceil -> 1004
    const order = await engine.placeOrder(
      cmd({ side: "SELL", type: "LIMIT", limitPrice: "1003.4" }),
    );
    expect(order.limitPrice).toBe("1004");
  });

  it("rejects SELL exceeding position (INSUFFICIENT_POSITION)", async () => {
    const { engine } = makeHarness({ positionJp: 100 });
    await expect(
      engine.placeOrder(cmd({ side: "SELL", quantity: 200 })),
    ).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "INSUFFICIENT_POSITION",
    );
  });

  it("rejects LIMIT BUY exceeding cash (INSUFFICIENT_FUNDS)", async () => {
    const { engine } = makeHarness({ cashJpy: "10000" });
    // 100 * 1000 = 100000 > 10000
    await expect(
      engine.placeOrder(cmd({ type: "LIMIT", limitPrice: "1000" })),
    ).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "INSUFFICIENT_FUNDS",
    );
  });

  it("rejects unknown instrument (NOT_FOUND)", async () => {
    const { engine } = makeHarness();
    await expect(
      engine.placeOrder(cmd({ instrumentId: "nope" })),
    ).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "NOT_FOUND",
    );
  });

  it("rejects malformed command via Zod (VALIDATION)", async () => {
    const { engine } = makeHarness();
    await expect(
      engine.placeOrder(cmd({ type: "LIMIT", limitPrice: undefined })),
    ).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "VALIDATION",
    );
  });
});

describe("cancelOrder", () => {
  it("cancels a PENDING order", async () => {
    const { engine } = makeHarness();
    const order = await engine.placeOrder(
      cmd({ type: "LIMIT", limitPrice: "500" }),
    );
    const cancelled = await engine.cancelOrder(order.id);
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("cannot cancel a FILLED order (ORDER_NOT_CANCELLABLE)", async () => {
    const { engine, prices } = makeHarness();
    const order = await engine.placeOrder(cmd({}));
    prices.set(JP_INSTRUMENT.id, "1000");
    await engine.evaluateOpenOrders({ now: T0, priceProvider: prices });
    await expect(engine.cancelOrder(order.id)).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "ORDER_NOT_CANCELLABLE",
    );
  });

  it("can cancel a PARTIALLY_FILLED order", async () => {
    const { engine, prices } = makeHarness({ liquidityCap: 100 });
    const order = await engine.placeOrder(cmd({ quantity: 300 }));
    prices.set(JP_INSTRUMENT.id, "1000");
    await engine.evaluateOpenOrders({ now: T0, priceProvider: prices });
    const reloaded = await engine.cancelOrder(order.id);
    expect(reloaded.status).toBe("CANCELLED");
    expect(reloaded.filledQuantity).toBe(100);
  });

  it("throws NOT_FOUND for unknown order", async () => {
    const { engine } = makeHarness();
    await expect(engine.cancelOrder("ghost")).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "NOT_FOUND",
    );
  });
});

describe("evaluateOpenOrders — fills", () => {
  it("MARKET fills immediately and FILLED == quantity", async () => {
    const { engine, prices, orders } = makeHarness({ noSlippage: true });
    await engine.placeOrder(cmd({}));
    prices.set(JP_INSTRUMENT.id, "1000");
    const trades = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    expect(trades).toHaveLength(1);
    expect(trades[0]!.quantity).toBe(100);
    expect(trades[0]!.price).toBe("1000");
    const o = orders.all()[0]!;
    expect(o.status).toBe("FILLED");
    expect(o.filledQuantity).toBe(o.quantity);
  });

  it("applies unfavorable slippage to MARKET BUY", async () => {
    const { engine, prices } = makeHarness();
    await engine.placeOrder(cmd({}));
    prices.set(JP_INSTRUMENT.id, "1000");
    const [trade] = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    // 5bps slippage up: 1000 * 1.0005 = 1000.5
    expect(trade!.price).toBe("1000.5");
  });

  it("LIMIT BUY only fills when market <= limit", async () => {
    const { engine, prices, orders } = makeHarness({ noSlippage: true });
    const order = await engine.placeOrder(
      cmd({ type: "LIMIT", limitPrice: "1000" }),
    );
    prices.set(JP_INSTRUMENT.id, "1010");
    let trades = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    expect(trades).toHaveLength(0);
    expect((await orders.findById(order.id))!.status).toBe("PENDING");

    prices.set(JP_INSTRUMENT.id, "995");
    trades = await engine.evaluateOpenOrders({ now: T0, priceProvider: prices });
    expect(trades).toHaveLength(1);
    expect(trades[0]!.price).toBe("995");
  });

  it("STOP triggers and fills once market crosses stopPrice (SELL stop)", async () => {
    const { engine, prices, orders } = makeHarness({
      positionJp: 100,
      noSlippage: true,
    });
    const order = await engine.placeOrder(
      cmd({ side: "SELL", type: "STOP", stopPrice: "900" }),
    );
    prices.set(JP_INSTRUMENT.id, "950");
    let trades = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    expect(trades).toHaveLength(0); // not triggered

    prices.set(JP_INSTRUMENT.id, "880");
    trades = await engine.evaluateOpenOrders({ now: T0, priceProvider: prices });
    expect(trades).toHaveLength(1);
    expect((await orders.findById(order.id))!.status).toBe("FILLED");
  });

  it("STOP_LIMIT triggers then requires limit reach", async () => {
    const { engine, prices, orders } = makeHarness({ noSlippage: true });
    // BUY stop 1100 trigger, limit 1100
    const order = await engine.placeOrder(
      cmd({ type: "STOP_LIMIT", stopPrice: "1100", limitPrice: "1100" }),
    );
    prices.set(JP_INSTRUMENT.id, "1120"); // triggers stop, but market>limit for BUY -> no fill
    let trades = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    expect(trades).toHaveLength(0);
    expect((await orders.findById(order.id))!.status).toBe("PENDING");

    prices.set(JP_INSTRUMENT.id, "1095"); // already triggered, now market<=limit -> fill
    trades = await engine.evaluateOpenOrders({ now: T0, priceProvider: prices });
    expect(trades).toHaveLength(1);
    expect(trades[0]!.price).toBe("1095");
  });

  it("supports partial fills across evaluations (liquidity cap)", async () => {
    const { engine, prices, orders } = makeHarness({
      liquidityCap: 100,
      noSlippage: true,
    });
    const order = await engine.placeOrder(cmd({ quantity: 300 }));
    prices.set(JP_INSTRUMENT.id, "1000");

    await engine.evaluateOpenOrders({ now: T0, priceProvider: prices });
    let o = (await orders.findById(order.id))!;
    expect(o.status).toBe("PARTIALLY_FILLED");
    expect(o.filledQuantity).toBe(100);

    await engine.evaluateOpenOrders({ now: T0, priceProvider: prices });
    await engine.evaluateOpenOrders({ now: T0, priceProvider: prices });
    o = (await orders.findById(order.id))!;
    expect(o.status).toBe("FILLED");
    expect(o.filledQuantity).toBe(300);
  });

  it("expires DAY orders the next UTC day (EXPIRED)", async () => {
    const { engine, prices, orders } = makeHarness();
    const order = await engine.placeOrder(
      cmd({ type: "LIMIT", limitPrice: "500" }),
    );
    prices.set(JP_INSTRUMENT.id, "1000"); // would not fill (BUY limit 500)
    const nextDay = new Date("2026-06-20T01:00:00Z");
    const trades = await engine.evaluateOpenOrders({
      now: nextDay,
      priceProvider: prices,
    });
    expect(trades).toHaveLength(0);
    expect((await orders.findById(order.id))!.status).toBe("EXPIRED");
  });

  it("GTC orders survive across days", async () => {
    const { engine, prices, orders } = makeHarness({ noSlippage: true });
    const order = await engine.placeOrder(
      cmd({ type: "LIMIT", limitPrice: "1000", timeInForce: "GTC" }),
    );
    prices.set(JP_INSTRUMENT.id, "1010");
    const nextDay = new Date("2026-06-25T01:00:00Z");
    await engine.evaluateOpenOrders({ now: nextDay, priceProvider: prices });
    expect((await orders.findById(order.id))!.status).toBe("PENDING");
  });
});

describe("fees", () => {
  it("charges JP tiered fee with tax on a fill", async () => {
    const { engine, prices } = makeHarness({ noSlippage: true });
    await engine.placeOrder(cmd({})); // 100 * price
    prices.set(JP_INSTRUMENT.id, "1000"); // notional 100000 -> tier upTo 100000 fee 99 *1.1=108.9 -> ceil 109
    const [trade] = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    expect(trade!.fee).toBe("109");
    expect(trade!.currency).toBe("JPY");
  });

  it("charges US min commission + sell regulatory fee", async () => {
    const { engine, prices } = makeHarness({
      positionUs: 10,
      noSlippage: true,
    });
    await engine.placeOrder(
      cmd({
        instrumentId: US_INSTRUMENT.id,
        side: "SELL",
        type: "LIMIT",
        limitPrice: "100",
        quantity: 10,
      }),
    );
    prices.set(US_INSTRUMENT.id, "100");
    const [trade] = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    // per-share 0.005*10=0.05 -> min 1.00; notional 1000 * 0.0000278 = 0.0278; sum=1.0278 -> ceil cents 1.03
    expect(trade!.fee).toBe("1.03");
    expect(trade!.currency).toBe("USD");
  });
});

describe("invariants", () => {
  it("filledQuantity never exceeds quantity and Trade conforms to schema", async () => {
    const { engine, prices, orders } = makeHarness({
      liquidityCap: 100,
      noSlippage: true,
    });
    await engine.placeOrder(cmd({ quantity: 100 }));
    prices.set(JP_INSTRUMENT.id, "1000");
    const trades = await engine.evaluateOpenOrders({
      now: T0,
      priceProvider: prices,
    });
    for (const t of trades) expect(Trade.safeParse(t).success).toBe(true);
    const o = orders.all()[0]!;
    expect(o.filledQuantity).toBeLessThanOrEqual(o.quantity);
  });
});
