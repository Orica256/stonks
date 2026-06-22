import { describe, expect, it } from "vitest";
import {
  Order,
  OrderActivation,
  OrderLinkType,
  OrderGroup,
  PlaceBracketOrderCommand,
  POSITION_UNIQUE_KEY,
  Position,
} from "./index.js";

describe("OrderLinkType / OrderActivation (Phase 5)", () => {
  it("enumerates OCO/IFD and ACTIVE/WAITING", () => {
    expect(OrderLinkType.options).toEqual(["OCO", "IFD"]);
    expect(OrderActivation.options).toEqual(["ACTIVE", "WAITING"]);
    expect(OrderLinkType.safeParse("BRACKET").success).toBe(false);
    expect(OrderActivation.safeParse("DONE").success).toBe(false);
  });
});

describe("Order link fields (後方互換)", () => {
  const base = {
    id: "o1",
    accountId: "a1",
    instrumentId: "TSE:7203",
    side: "BUY" as const,
    type: "MARKET" as const,
    quantity: 100,
    createdAt: "2026-06-23T00:00:00Z",
    updatedAt: "2026-06-23T00:00:00Z",
  };

  it("single order omits all link fields (従来注文は連動しない)", () => {
    const r = Order.parse(base);
    expect(r.linkGroupId).toBeUndefined();
    expect(r.linkType).toBeUndefined();
    expect(r.parentOrderId).toBeUndefined();
    expect(r.activation).toBeUndefined();
  });

  it("accepts an OCO leg (linkGroupId + linkType=OCO, ACTIVE)", () => {
    const r = Order.parse({
      ...base,
      type: "LIMIT",
      limitPrice: "2100",
      linkGroupId: "grp1",
      linkType: "OCO",
      activation: "ACTIVE",
    });
    expect(r.linkGroupId).toBe("grp1");
    expect(r.linkType).toBe("OCO");
    expect(r.activation).toBe("ACTIVE");
  });

  it("accepts an IFD child (parentOrderId + WAITING)", () => {
    const r = Order.parse({
      ...base,
      type: "LIMIT",
      limitPrice: "2200",
      parentOrderId: "o1",
      linkType: "IFD",
      activation: "WAITING",
    });
    expect(r.parentOrderId).toBe("o1");
    expect(r.activation).toBe("WAITING");
  });
});

describe("PlaceBracketOrderCommand (OCO/IFD/bracket)", () => {
  it("accepts an OCO command with 2 legs", () => {
    const r = PlaceBracketOrderCommand.safeParse({
      kind: "OCO",
      legs: [{ type: "LIMIT" }, { type: "STOP" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects OCO with the wrong number of legs", () => {
    expect(
      PlaceBracketOrderCommand.safeParse({ kind: "OCO", legs: [{}] }).success,
    ).toBe(false);
    expect(
      PlaceBracketOrderCommand.safeParse({
        kind: "OCO",
        legs: [{}, {}, {}],
      }).success,
    ).toBe(false);
  });

  it("accepts an IFD command with parent + children", () => {
    const r = PlaceBracketOrderCommand.safeParse({
      kind: "IFD",
      parent: { type: "LIMIT" },
      children: [{ type: "LIMIT" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects IFD with empty children", () => {
    expect(
      PlaceBracketOrderCommand.safeParse({
        kind: "IFD",
        parent: {},
        children: [],
      }).success,
    ).toBe(false);
  });

  it("accepts a BRACKET command with exactly 2 children", () => {
    const r = PlaceBracketOrderCommand.safeParse({
      kind: "BRACKET",
      parent: { type: "MARKET" },
      children: [{ type: "LIMIT" }, { type: "STOP" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(
      PlaceBracketOrderCommand.safeParse({ kind: "TRAILING", legs: [{}, {}] })
        .success,
    ).toBe(false);
  });
});

describe("OrderGroup", () => {
  it("requires at least 2 orderIds", () => {
    const ok = OrderGroup.safeParse({
      id: "grp1",
      accountId: "a1",
      linkType: "OCO",
      orderIds: ["o1", "o2"],
      createdAt: "2026-06-23T00:00:00Z",
    });
    expect(ok.success).toBe(true);
    const bad = OrderGroup.safeParse({
      id: "grp1",
      accountId: "a1",
      linkType: "OCO",
      orderIds: ["o1"],
      createdAt: "2026-06-23T00:00:00Z",
    });
    expect(bad.success).toBe(false);
  });
});

describe("Position unique key (CASH/MARGIN 分離。Phase 5)", () => {
  it("POSITION_UNIQUE_KEY includes marginType", () => {
    expect(POSITION_UNIQUE_KEY).toEqual([
      "accountId",
      "instrumentId",
      "side",
      "marginType",
    ]);
  });

  it("CASH and MARGIN LONG positions differ only by marginType (別行になりうる)", () => {
    const common = {
      accountId: "a1",
      instrumentId: "TSE:7203",
      quantity: 100,
      avgCost: "2000",
      currency: "JPY" as const,
      side: "LONG" as const,
      openedAt: "2026-06-23T00:00:00Z",
    };
    const cash = Position.parse({ ...common, id: "p-cash" });
    const margin = Position.parse({
      ...common,
      id: "p-margin",
      marginType: "MARGIN",
      margin: {
        postedMargin: "60000",
        initialMarginRate: "0.30",
        maintenanceMarginRate: "0.20",
        annualRate: "0.011",
      },
    });
    // 一意キー要素を marginType ?? "CASH" で評価すると CASH/MARGIN は別キーになる。
    const keyOf = (p: typeof cash) =>
      [p.accountId, p.instrumentId, p.side, p.marginType ?? "CASH"].join("|");
    expect(keyOf(cash)).not.toBe(keyOf(margin));
    expect(keyOf(cash)).toBe("a1|TSE:7203|LONG|CASH");
    expect(keyOf(margin)).toBe("a1|TSE:7203|LONG|MARGIN");
  });
});
