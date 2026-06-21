import { afterEach, describe, expect, it, vi } from "vitest";
import type { BacktestResult, RunBacktestRequest } from "@stonks/contracts";
import { runBacktest } from "./endpoints";

/**
 * `runBacktest` のフェイク fetch テスト（spec §6.8 POST /backtests）。
 * web は実 API に依存せず、メソッド/パス/本文と戻り値整形のみを検証する。
 */

const request: RunBacktestRequest = {
  strategy: {
    name: "SMA Cross 20/50",
    universe: ["TSE:7203"],
    timeframe: "1d",
    indicators: [{ kind: "SMA", params: { period: 20 } }],
    rules: [
      {
        when: "SMA(20) crossUp SMA(50)",
        action: "BUY",
        sizing: { mode: "EQUITY_PCT", value: 1 },
      },
    ],
  },
  range: { from: "2025-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" },
  initialCash: "1000000",
};

const result: BacktestResult = {
  metrics: {
    totalReturn: 0.12,
    maxDrawdown: 0.2,
    sharpe: 1.1,
    winRate: 0.55,
    trades: 8,
  },
  equityCurve: [{ ts: "2025-01-01T00:00:00.000Z", equity: "1000000" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runBacktest", () => {
  it("POST /backtests に RunBacktestRequest を JSON で送る", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const got = await runBacktest(request);

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(String(url)).toContain("/backtests");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(request);
    expect(got).toEqual(result);
  });

  it("API エラーを ApiError として伝播する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "BAD_REQUEST", message: "range が不正です" },
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      ),
    );

    await expect(runBacktest(request)).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
  });
});
