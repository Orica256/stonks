import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarginRequirement } from "@stonks/contracts";
import { ApiError } from "./client";
import { getMarginRequirement } from "./endpoints";

/**
 * 必要保証金プレビュー クライアント（GET /instruments/:id/margin-requirement）の
 * フェイク fetch テスト（Phase 7）。メソッド/パス/クエリ組み立てと、400→ApiError 伝播を検証する。
 */

const requirement: MarginRequirement = {
  notional: "1500000",
  requiredMargin: "450000",
  initialMarginRate: "0.3",
  currency: "JPY",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getMarginRequirement", () => {
  it("GET /instruments/:id/margin-requirement を side/quantity/price 付きで叩く", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(requirement), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const got = await getMarginRequirement("TSE:7203", {
      side: "BUY",
      quantity: 100,
      price: "15000",
      marginType: "MARGIN",
    });

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const url = String(call[0]);
    expect(url).toContain("/instruments/TSE%3A7203/margin-requirement");
    expect(url).toContain("side=BUY");
    expect(url).toContain("quantity=100");
    expect(url).toContain("price=15000");
    expect(url).toContain("marginType=MARGIN");
    expect(got).toEqual(requirement);
  });

  it("price 省略時は price クエリを付けない（api が最新価格を使う）", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(requirement), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await getMarginRequirement("TSE:7203", { side: "SELL", quantity: 200 });

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const url = String(call[0]);
    expect(url).not.toContain("price=");
    expect(url).toContain("side=SELL");
  });

  it("信用不可（HTTP 400）のとき ApiError を投げる（捏造値を返さない）", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: "MARGIN_NOT_ALLOWED" } }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      getMarginRequirement("TSE:9999", { side: "BUY", quantity: 100 }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
