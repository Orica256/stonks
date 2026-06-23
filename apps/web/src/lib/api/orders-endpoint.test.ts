import { afterEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@stonks/contracts";
import { cancelOrder, getOrders } from "./endpoints";

/**
 * 注文一覧/単発取消クライアントのフェイク fetch テスト
 * （GET /accounts/:id/orders, DELETE /orders/:id）。
 * web は実 API に依存せず、メソッド/パス/クエリと戻り値整形のみを検証する。
 */

const orders: Order[] = [
  {
    id: "ord-1",
    accountId: "acc-1",
    instrumentId: "TSE:7203",
    side: "SELL",
    type: "LIMIT",
    quantity: 100,
    filledQuantity: 0,
    limitPrice: "1500",
    timeInForce: "GTC",
    status: "PENDING",
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getOrders", () => {
  it("GET /accounts/:id/orders を叩き Order[] を返す（open 未指定時はクエリ無し）", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(orders), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const got = await getOrders("acc-1");

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url] = call;
    expect(String(url)).toContain("/accounts/acc-1/orders");
    expect(String(url)).not.toContain("open=");
    expect(got).toEqual(orders);
  });

  it("open=true を渡すと ?open=true を付与する", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(orders), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await getOrders("acc-1", true);

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url] = call;
    expect(String(url)).toContain("open=true");
  });
});

describe("cancelOrder", () => {
  it("DELETE /orders/:id を叩き取消後の Order を返す", async () => {
    const cancelled: Order = { ...orders[0]!, status: "CANCELLED" };
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(cancelled), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const got = await cancelOrder("ord-1");

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(String(url)).toContain("/orders/ord-1");
    expect(init.method).toBe("DELETE");
    expect(got).toEqual(cancelled);
  });
});
