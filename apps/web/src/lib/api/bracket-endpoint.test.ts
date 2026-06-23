import { afterEach, describe, expect, it, vi } from "vitest";
import type { Order, PlaceBracketOrderCommand } from "@stonks/contracts";
import { cancelOrderGroup, placeBracketOrder } from "./endpoints";

/**
 * 複合注文クライアントのフェイク fetch テスト
 * （POST /accounts/:id/orders/bracket, DELETE /orders/groups/:linkGroupId）。
 * web は実 API に依存せず、メソッド/パス/本文と戻り値整形のみを検証する。
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
    linkGroupId: "grp-1",
    linkType: "OCO",
    activation: "ACTIVE",
    status: "PENDING",
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
  },
  {
    id: "ord-2",
    accountId: "acc-1",
    instrumentId: "TSE:7203",
    side: "SELL",
    type: "STOP",
    quantity: 100,
    filledQuantity: 0,
    stopPrice: "1200",
    timeInForce: "GTC",
    linkGroupId: "grp-1",
    linkType: "OCO",
    activation: "ACTIVE",
    status: "PENDING",
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("placeBracketOrder", () => {
  it("POST /accounts/:id/orders/bracket に複合コマンドを JSON で送り Order[] を返す", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(orders), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const command: PlaceBracketOrderCommand = {
      kind: "OCO",
      legs: [
        {
          instrumentId: "TSE:7203",
          side: "SELL",
          type: "LIMIT",
          quantity: 100,
          limitPrice: "1500",
          timeInForce: "GTC",
        },
        {
          instrumentId: "TSE:7203",
          side: "SELL",
          type: "STOP",
          quantity: 100,
          stopPrice: "1200",
          timeInForce: "GTC",
        },
      ],
    };

    const got = await placeBracketOrder("acc-1", command);

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(String(url)).toContain("/accounts/acc-1/orders/bracket");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(command);
    expect(got).toEqual(orders);
  });
});

describe("cancelOrderGroup", () => {
  it("DELETE /orders/groups/:linkGroupId を叩き取消後の Order[] を返す", async () => {
    const cancelled = orders.map((o) => ({ ...o, status: "CANCELLED" as const }));
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(cancelled), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const got = await cancelOrderGroup("grp-1");

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(String(url)).toContain("/orders/groups/grp-1");
    expect(init.method).toBe("DELETE");
    expect(got).toEqual(cancelled);
  });

  it("API エラーを ApiError として伝播する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "NOT_FOUND", message: "グループがありません" },
            }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      ),
    );

    await expect(cancelOrderGroup("nope")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });
});
