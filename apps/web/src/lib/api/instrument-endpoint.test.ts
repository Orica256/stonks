import { afterEach, describe, expect, it, vi } from "vitest";
import type { Instrument } from "@stonks/contracts";
import { ApiError } from "./client";
import { getInstrument } from "./endpoints";

/**
 * 銘柄メタ取得クライアント（GET /instruments/:id）のフェイク fetch テスト（Phase 6）。
 * web は実 API に依存せず、メソッド/パスと戻り値整形、404→ApiError 伝播のみを検証する。
 */

const instrument: Instrument = {
  id: "TSE:7203",
  symbol: "7203",
  exchange: "TSE",
  market: "JP",
  name: "トヨタ自動車",
  currency: "JPY",
  type: "STOCK",
  lotSize: 100,
  tickRules: [],
  isActive: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getInstrument", () => {
  it("GET /instruments/:id を叩き Instrument を返す（id は URL エンコード）", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(instrument), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const got = await getInstrument("TSE:7203");

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url] = call;
    expect(String(url)).toContain("/instruments/TSE%3A7203");
    expect(got).toEqual(instrument);
  });

  it("404 のとき ApiError を投げる（捏造値を返さない）", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(getInstrument("TSE:9999")).rejects.toBeInstanceOf(ApiError);
  });
});
