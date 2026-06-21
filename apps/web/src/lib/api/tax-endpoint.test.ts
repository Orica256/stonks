import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapitalGainsTaxEstimate } from "@stonks/contracts";
import { getCapitalGainsTax } from "./endpoints";

/**
 * `getCapitalGainsTax` のフェイク fetch テスト（spec §2.3 P1 GET /accounts/:id/tax）。
 * web は実 API に依存せず、メソッド/パス/クエリと戻り値整形のみを検証する。
 */

const estimates: CapitalGainsTaxEstimate[] = [
  {
    accountId: "acc-1",
    range: {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-06-20T00:00:00.000Z",
    },
    currency: "JPY",
    realizedGains: "120000",
    taxRate: "0.20315",
    estimatedTax: "24378",
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getCapitalGainsTax", () => {
  it("GET /accounts/:id/tax に from/to をクエリで送り CapitalGainsTaxEstimate[] を返す", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(estimates), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const got = await getCapitalGainsTax("acc-1", {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-06-20T00:00:00.000Z",
    });

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(String(call[0]));
    expect(url.pathname).toContain("/accounts/acc-1/tax");
    expect(call[1].method ?? "GET").toBe("GET");
    expect(url.searchParams.get("from")).toBe("2026-01-01T00:00:00.000Z");
    expect(url.searchParams.get("to")).toBe("2026-06-20T00:00:00.000Z");
    expect(got).toEqual(estimates);
  });

  it("range 無指定では from/to を付けずに叩く（API 既定期間に委ねる）", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(estimates), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await getCapitalGainsTax("acc-1");

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(String(call[0]));
    expect(url.searchParams.has("from")).toBe(false);
    expect(url.searchParams.has("to")).toBe(false);
  });

  it("accountId を URL エンコードする", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(estimates), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await getCapitalGainsTax("acc/1");

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toContain("acc%2F1");
  });

  it("API エラーを ApiError として伝播する（未提供時の縮退）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "NOT_FOUND", message: "未実装です" },
            }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      ),
    );

    await expect(getCapitalGainsTax("acc-1")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });
});
