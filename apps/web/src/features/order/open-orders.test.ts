import { describe, expect, it } from "vitest";
import type { Order } from "@stonks/contracts";
import {
  filterOpenOrders,
  groupOpenOrders,
  isOpenOrder,
  orderStatusLabel,
} from "./open-orders";

/**
 * オープン注文ロジック（絞り込み・グルーピング）の純粋テスト。
 * UI に依らず、status/activation のオープン判定と複合関係の束ね方を検証する。
 */

function order(partial: Partial<Order> & Pick<Order, "id">): Order {
  return {
    accountId: "acc-1",
    instrumentId: "TSE:7203",
    side: "SELL",
    type: "LIMIT",
    quantity: 100,
    filledQuantity: 0,
    timeInForce: "DAY",
    status: "PENDING",
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
    ...partial,
  };
}

describe("isOpenOrder", () => {
  it("PENDING / PARTIALLY_FILLED はオープン", () => {
    expect(isOpenOrder(order({ id: "a", status: "PENDING" }))).toBe(true);
    expect(
      isOpenOrder(order({ id: "b", status: "PARTIALLY_FILLED" })),
    ).toBe(true);
  });

  it("FILLED / CANCELLED / REJECTED / EXPIRED はオープンでない", () => {
    expect(isOpenOrder(order({ id: "a", status: "FILLED" }))).toBe(false);
    expect(isOpenOrder(order({ id: "b", status: "CANCELLED" }))).toBe(false);
    expect(isOpenOrder(order({ id: "c", status: "REJECTED" }))).toBe(false);
    expect(isOpenOrder(order({ id: "d", status: "EXPIRED" }))).toBe(false);
  });

  it("WAITING（親約定待ち）は status PENDING ならオープン", () => {
    expect(
      isOpenOrder(order({ id: "a", status: "PENDING", activation: "WAITING" })),
    ).toBe(true);
  });

  it("WAITING でも取消済みはオープンでない", () => {
    expect(
      isOpenOrder(
        order({ id: "a", status: "CANCELLED", activation: "WAITING" }),
      ),
    ).toBe(false);
  });
});

describe("filterOpenOrders", () => {
  it("オープンのみ残す", () => {
    const list = [
      order({ id: "open", status: "PENDING" }),
      order({ id: "filled", status: "FILLED" }),
      order({ id: "cancel", status: "CANCELLED" }),
    ];
    expect(filterOpenOrders(list).map((o) => o.id)).toEqual(["open"]);
  });
});

describe("groupOpenOrders", () => {
  it("同一 linkGroupId を 1 グループに束ね linkGroupId を露出する", () => {
    const list = [
      order({ id: "oco-1", linkGroupId: "g1", linkType: "OCO" }),
      order({ id: "oco-2", linkGroupId: "g1", linkType: "OCO" }),
      order({ id: "single", linkType: undefined }),
    ];
    const groups = groupOpenOrders(list);
    const oco = groups.find((g) => g.linkGroupId === "g1");
    expect(oco).toBeDefined();
    expect(oco!.orders.map((o) => o.id).sort()).toEqual(["oco-1", "oco-2"]);
    expect(oco!.linkType).toBe("OCO");

    const single = groups.find((g) => g.orders[0]!.id === "single");
    expect(single).toBeDefined();
    expect(single!.linkGroupId).toBeUndefined();
  });

  it("IFD 親子を 1 グループにし親を先頭に置く", () => {
    const list = [
      order({
        id: "child",
        parentOrderId: "parent",
        linkType: "OCO",
        activation: "WAITING",
        createdAt: "2026-06-23T00:00:01.000Z",
      }),
      order({
        id: "parent",
        side: "BUY",
        type: "MARKET",
        linkType: "IFD",
        createdAt: "2026-06-23T00:00:00.000Z",
      }),
    ];
    const groups = groupOpenOrders(list);
    // 親キー（p:parent）で 1 グループに束ねる。
    const grp = groups.find((g) =>
      g.orders.some((o) => o.id === "parent"),
    );
    expect(grp).toBeDefined();
    expect(grp!.orders.map((o) => o.id)).toEqual(["parent", "child"]);
  });

  it("オープンでない注文はグループから除外する", () => {
    const list = [
      order({ id: "open", status: "PENDING" }),
      order({ id: "done", status: "FILLED" }),
    ];
    const groups = groupOpenOrders(list);
    const allIds = groups.flatMap((g) => g.orders.map((o) => o.id));
    expect(allIds).toEqual(["open"]);
  });
});

describe("orderStatusLabel", () => {
  it("status を日本語に整形する", () => {
    expect(orderStatusLabel("PENDING")).toBe("未約定");
    expect(orderStatusLabel("PARTIALLY_FILLED")).toBe("一部約定");
    expect(orderStatusLabel("CANCELLED")).toBe("取消済");
  });
});
