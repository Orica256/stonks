import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "./client";

/** fetch をフェイクに差し替える（web は実 API に依存せずテストする。spec §7.2）。 */
function mockFetch(response: Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response)),
  );
}

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it("OK レスポンスの JSON をパースして返す", async () => {
    mockFetch(jsonResponse([{ id: "TSE:7203" }]));
    const result = await apiRequest<{ id: string }[]>("/instruments");
    expect(result).toEqual([{ id: "TSE:7203" }]);
  });

  it("クエリを URL に組み立て、undefined/空文字は除外する", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal("fetch", fetchSpy);

    await apiRequest("/instruments", {
      query: { q: "toyota", market: undefined, empty: "" },
    });

    const url = String((fetchSpy.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("q=toyota");
    expect(url).not.toContain("market=");
    expect(url).not.toContain("empty=");
  });

  it("エラー本文の code/message を ApiError に正規化する", async () => {
    mockFetch(
      jsonResponse(
        { error: { code: "INSUFFICIENT_FUNDS", message: "現金が不足しています" } },
        { status: 422 },
      ),
    );

    await expect(apiRequest("/accounts/a/orders", { method: "POST", body: {} }))
      .rejects.toMatchObject({
        status: 422,
        code: "INSUFFICIENT_FUNDS",
        message: "現金が不足しています",
      });
  });

  it("204 は undefined を返す", async () => {
    mockFetch(new Response(null, { status: 204 }));
    const result = await apiRequest("/orders/x", { method: "DELETE" });
    expect(result).toBeUndefined();
  });

  it("JSON でないエラー本文でもステータスを保持する", async () => {
    mockFetch(new Response("oops", { status: 500 }));
    const err = await apiRequest("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });
});
