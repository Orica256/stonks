import { afterEach, describe, expect, it, vi } from "vitest";
import type { CorporateAction } from "@stonks/contracts";
import { applyCorporateAction, getCorporateActions } from "./endpoints";

/**
 * コーポレートアクション系クライアントのフェイク fetch テスト
 * （GET /instruments/:id/corporate-actions, POST /accounts/:id/corporate-actions）。
 * web は実 API に依存せず、メソッド/パス/クエリ/本文と戻り値整形のみを検証する。
 */

const actions: CorporateAction[] = [
  {
    instrumentId: "TSE:7203",
    type: "DIVIDEND",
    exDate: "2026-03-30T00:00:00.000Z",
    value: "75",
  },
  {
    instrumentId: "TSE:7203",
    type: "SPLIT",
    exDate: "2026-04-01T00:00:00.000Z",
    value: "2",
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getCorporateActions", () => {
  it("GET /instruments/:id/corporate-actions に from/to をクエリで送り CorporateAction[] を返す", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(actions), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const got = await getCorporateActions("TSE:7203", {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-06-20T00:00:00.000Z",
    });

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(String(call[0]));
    expect(url.pathname).toContain(
      "/instruments/TSE%3A7203/corporate-actions",
    );
    expect(call[1].method ?? "GET").toBe("GET");
    expect(url.searchParams.get("from")).toBe("2026-01-01T00:00:00.000Z");
    expect(url.searchParams.get("to")).toBe("2026-06-20T00:00:00.000Z");
    expect(got).toEqual(actions);
  });

  it("range 無指定では from/to を付けずに叩く（API 既定範囲に委ねる）", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(actions), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await getCorporateActions("TSE:7203");

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(String(call[0]));
    expect(url.searchParams.has("from")).toBe(false);
    expect(url.searchParams.has("to")).toBe(false);
  });
});

describe("applyCorporateAction", () => {
  it("POST /accounts/:id/corporate-actions に CorporateAction を JSON で送る", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const got = await applyCorporateAction("acc-1", actions[0]!);

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(String(url)).toContain("/accounts/acc-1/corporate-actions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(actions[0]);
    expect(got).toEqual({ ok: true });
  });

  it("API エラーを ApiError として伝播する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "BAD_REQUEST", message: "保有がありません" },
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      ),
    );

    await expect(
      applyCorporateAction("acc-1", actions[0]!),
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
  });
});
