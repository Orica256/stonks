import { describe, expect, it } from "vitest";
import { ApiClient, ApiError, type FetchLike } from "./api-client.js";
import {
  cancelOrder,
  getPerformance,
  getPortfolio,
  getQuote,
  placeOrder,
  searchInstruments,
  type ToolDeps,
} from "./tools.js";

/**
 * mcp-server のツールハンドラ単体テスト。
 *
 * 実 api・実ネットワークに依存せず、フェイク fetch に対して検証する
 * （CLAUDE.md §3）。重点:
 *  - place_order が rationale 付きで POST /accounts/:id/agent-decisions を叩くこと
 *  - 素の POST /orders を rationale 無しで叩かないこと（監査証跡。spec §5.2/§8）
 *  - 各ツールが正しい HTTP メソッド・パス・クエリへ向かうこと
 */

interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

/** 呼び出しを記録し、ルーティングに応じて JSON を返すフェイク fetch を作る。 */
const makeFakeFetch = (
  routes: (req: RecordedRequest) => { status?: number; body: unknown },
): { fetch: FetchLike; requests: RecordedRequest[] } => {
  const requests: RecordedRequest[] = [];
  const fetch: FetchLike = async (input, init) => {
    const req: RecordedRequest = {
      method: init?.method ?? "GET",
      url: input,
      body: init?.body !== undefined ? JSON.parse(init.body) : undefined,
    };
    requests.push(req);
    const { status = 200, body } = routes(req);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === undefined ? "" : JSON.stringify(body)),
    };
  };
  return { fetch, requests };
};

const BASE = "http://api.test";

const makeDeps = (
  routes: (req: RecordedRequest) => { status?: number; body: unknown },
  defaultAgentProfileId?: string,
): { deps: ToolDeps; requests: RecordedRequest[] } => {
  const { fetch, requests } = makeFakeFetch(routes);
  const api = new ApiClient({ baseUrl: BASE, fetch });
  return { deps: { api, defaultAgentProfileId }, requests };
};

// ── フィクスチャ（contracts スキーマに準拠した最小の有効値） ──

const instrumentFixture = {
  id: "TSE:7203",
  symbol: "7203",
  exchange: "TSE",
  market: "JP",
  name: "Toyota",
  currency: "JPY",
  type: "STOCK",
  lotSize: 100,
  tickRules: [],
  isActive: true,
};

const quoteFixture = {
  instrumentId: "TSE:7203",
  last: "2500",
  ts: "2026-06-20T00:00:00.000Z",
  source: "test",
};

const summaryFixture = {
  accountId: "acc-1",
  baseCurrency: "JPY",
  cash: { amount: "1000000", currency: "JPY" },
  positionsValue: { amount: "0", currency: "JPY" },
  equity: { amount: "1000000", currency: "JPY" },
  unrealizedPnl: { amount: "0", currency: "JPY" },
  realizedPnl: { amount: "0", currency: "JPY" },
};

const snapshotFixture = {
  accountId: "acc-1",
  ts: "2026-06-20T00:00:00.000Z",
  equity: "1000000",
  cash: "1000000",
  positionsValue: "0",
  cumulativeReturn: 0,
  maxDrawdown: 0,
  sharpe: 0,
  winRate: 0,
};

const orderFixture = {
  id: "ord-1",
  accountId: "acc-1",
  instrumentId: "TSE:7203",
  side: "BUY",
  type: "MARKET",
  quantity: 100,
  filledQuantity: 0,
  timeInForce: "DAY",
  status: "PENDING",
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
};

describe("searchInstruments", () => {
  it("GET /instruments with q and market query", async () => {
    const { deps, requests } = makeDeps(() => ({ body: [instrumentFixture] }));
    const result = await searchInstruments(deps, { q: "toyota", market: "JP" });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe(`${BASE}/instruments?q=toyota&market=JP`);
    expect(result[0]?.id).toBe("TSE:7203");
  });

  it("omits market from query when not provided", async () => {
    const { deps, requests } = makeDeps(() => ({ body: [] }));
    await searchInstruments(deps, { q: "aapl" });
    expect(requests[0]?.url).toBe(`${BASE}/instruments?q=aapl`);
  });
});

describe("getQuote", () => {
  it("GET /instruments/:id/quote with encoded id", async () => {
    const { deps, requests } = makeDeps(() => ({ body: quoteFixture }));
    const result = await getQuote(deps, { instrumentId: "TSE:7203" });

    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe(`${BASE}/instruments/TSE%3A7203/quote`);
    expect(result.last).toBe("2500");
  });
});

describe("getPortfolio", () => {
  it("fetches summary and positions and combines them", async () => {
    const { deps, requests } = makeDeps((req) =>
      req.url.endsWith("/summary")
        ? { body: summaryFixture }
        : { body: [] },
    );
    const result = await getPortfolio(deps, { accountId: "acc-1" });

    const urls = requests.map((r) => r.url).sort();
    expect(urls).toEqual([
      `${BASE}/accounts/acc-1/positions`,
      `${BASE}/accounts/acc-1/summary`,
    ]);
    expect(result.summary.accountId).toBe("acc-1");
    expect(result.positions).toEqual([]);
  });
});

describe("getPerformance", () => {
  it("GET /accounts/:id/performance with range and benchmark", async () => {
    const { deps, requests } = makeDeps(() => ({
      body: { snapshot: snapshotFixture, comparison: null },
    }));
    const result = await getPerformance(deps, {
      accountId: "acc-1",
      range: "3m",
      benchmark: "TOPIX",
    });

    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe(
      `${BASE}/accounts/acc-1/performance?range=3m&benchmark=TOPIX`,
    );
    expect(result.snapshot.sharpe).toBe(0);
    expect(result.comparison).toBeNull();
  });
});

describe("placeOrder", () => {
  const decisionResponse = { decisionId: "dec-1", orders: [orderFixture] };

  it("posts to agent-decisions with rationale and a single ORDER action", async () => {
    const { deps, requests } = makeDeps(() => ({ body: decisionResponse }));

    const result = await placeOrder(deps, {
      accountId: "acc-1",
      order: {
        instrumentId: "TSE:7203",
        side: "BUY",
        type: "MARKET",
        quantity: 100,
      },
      rationale: "momentum breakout",
      agentProfileId: "agent-1",
    });

    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${BASE}/accounts/acc-1/agent-decisions`);

    // 監査証跡: rationale 付き、ORDER アクション内包、accountId はパス正準で補完。
    const body = req.body as Record<string, unknown>;
    expect(body.rationale).toBe("momentum breakout");
    expect(body.agentProfileId).toBe("agent-1");
    const actions = body.actions as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe("ORDER");
    expect((actions[0]?.order as Record<string, unknown>).accountId).toBe(
      "acc-1",
    );
    expect(result.decisionId).toBe("dec-1");
  });

  it("never calls the raw POST /accounts/:id/orders endpoint", async () => {
    const { deps, requests } = makeDeps(() => ({ body: decisionResponse }));
    await placeOrder(deps, {
      accountId: "acc-1",
      order: {
        instrumentId: "TSE:7203",
        side: "BUY",
        type: "MARKET",
        quantity: 100,
      },
      rationale: "x",
      agentProfileId: "agent-1",
    });
    expect(requests.every((r) => !r.url.endsWith("/orders"))).toBe(true);
    expect(requests.every((r) => r.url.includes("/agent-decisions"))).toBe(true);
  });

  it("uses the configured default agent profile when not passed", async () => {
    const { deps, requests } = makeDeps(
      () => ({ body: decisionResponse }),
      "default-agent",
    );
    await placeOrder(deps, {
      accountId: "acc-1",
      order: {
        instrumentId: "TSE:7203",
        side: "BUY",
        type: "MARKET",
        quantity: 100,
      },
      rationale: "x",
    });
    expect((requests[0]?.body as Record<string, unknown>).agentProfileId).toBe(
      "default-agent",
    );
  });

  it("throws (no request) when no agent profile is available", async () => {
    const { deps, requests } = makeDeps(() => ({ body: decisionResponse }));
    await expect(
      placeOrder(deps, {
        accountId: "acc-1",
        order: {
          instrumentId: "TSE:7203",
          side: "BUY",
          type: "MARKET",
          quantity: 100,
        },
        rationale: "x",
      }),
    ).rejects.toThrow(/agentProfileId is required/);
    expect(requests).toHaveLength(0);
  });

  it("rejects an invalid order (LIMIT without limitPrice) before any request", async () => {
    const { deps, requests } = makeDeps(() => ({ body: decisionResponse }));
    await expect(
      placeOrder(deps, {
        accountId: "acc-1",
        order: {
          instrumentId: "TSE:7203",
          side: "BUY",
          type: "LIMIT",
          quantity: 100,
        },
        rationale: "x",
        agentProfileId: "agent-1",
      }),
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});

describe("cancelOrder", () => {
  it("DELETE /orders/:id", async () => {
    const { deps, requests } = makeDeps(() => ({ body: orderFixture }));
    const result = await cancelOrder(deps, { orderId: "ord-1" });

    expect(requests[0]?.method).toBe("DELETE");
    expect(requests[0]?.url).toBe(`${BASE}/orders/ord-1`);
    expect(result.status).toBe("PENDING");
  });
});

describe("ApiClient error handling", () => {
  it("throws ApiError on non-2xx responses", async () => {
    const { deps } = makeDeps(() => ({
      status: 422,
      body: { message: "bad" },
    }));
    await expect(getQuote(deps, { instrumentId: "TSE:7203" })).rejects.toThrow(
      ApiError,
    );
  });
});
