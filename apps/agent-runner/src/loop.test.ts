import { describe, expect, it } from "vitest";
import { ApiClient, type FetchLike } from "./api-client.js";
import {
  HoldDecisionProvider,
  type DecisionProvider,
  type DecisionResult,
} from "./decision-provider.js";
import { capActions, runAgentLoop, type RunLoopParams } from "./loop.js";

/**
 * 自律ループの単体テスト。
 *
 * 実 Redis / 実 LLM / 実ネットワークに依存せず、フェイク fetch と
 * フェイク DecisionProvider に対して検証する（CLAUDE.md §3）。重点（§8/§9）:
 *  - enabled=false なら観測も発注も行わない
 *  - rationale 空なら発注せず破棄（監査証跡必須。spec §5.2）
 *  - 発注上限を超えた ORDER/CANCEL は捨てる
 *  - 必ず POST /accounts/:id/agent-decisions（rationale 付き）を叩く
 */

interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

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

const observationFixture = {
  accountId: "acc-1",
  asOf: "2026-06-20T00:00:00.000Z",
  cashByCurrency: { JPY: "1000000" },
  positions: [],
  recentQuotes: [],
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

const buyOrderCommand = {
  accountId: "acc-1",
  instrumentId: "TSE:7203",
  side: "BUY",
  type: "MARKET",
  quantity: 100,
  timeInForce: "DAY",
} as const;

/** 指定の DecisionResult を返すフェイクプロバイダ。 */
const fakeProvider = (result: DecisionResult): DecisionProvider => ({
  decide: async () => result,
});

const baseParams: RunLoopParams = {
  accountId: "acc-1",
  agentProfileId: "agent-1",
  model: "claude-test",
  enabled: true,
  maxActionsPerLoop: 3,
};

/** 観測 GET と decision POST を捌くルータ。POST のレスポンスは decisionId+orders。 */
const defaultRoutes = (req: RecordedRequest) => {
  if (req.method === "GET" && req.url.endsWith("/observation")) {
    return { body: observationFixture };
  }
  if (req.method === "POST" && req.url.endsWith("/agent-decisions")) {
    return { body: { decisionId: "dec-1", orders: [orderFixture] } };
  }
  return { status: 404, body: { error: "unexpected" } };
};

describe("runAgentLoop", () => {
  it("does nothing when disabled (no observation, no decision)", async () => {
    const { fetch, requests } = makeFakeFetch(defaultRoutes);
    const api = new ApiClient({ baseUrl: BASE, fetch });
    const outcome = await runAgentLoop(
      { api, provider: new HoldDecisionProvider() },
      { ...baseParams, enabled: false },
    );
    expect(outcome.status).toBe("disabled");
    expect(requests).toHaveLength(0);
  });

  it("skips when accountId or agentProfileId is missing", async () => {
    const { fetch, requests } = makeFakeFetch(defaultRoutes);
    const api = new ApiClient({ baseUrl: BASE, fetch });
    const outcome = await runAgentLoop(
      { api, provider: new HoldDecisionProvider() },
      { ...baseParams, agentProfileId: "" },
    );
    expect(outcome.status).toBe("skipped");
    expect(requests).toHaveLength(0);
  });

  it("records a rationale-bearing AgentDecision (HOLD-only path, no orders)", async () => {
    const { fetch, requests } = makeFakeFetch(defaultRoutes);
    const api = new ApiClient({ baseUrl: BASE, fetch });
    const outcome = await runAgentLoop(
      { api, provider: new HoldDecisionProvider() },
      baseParams,
    );

    expect(outcome.status).toBe("submitted");
    // 観測 GET → decision POST の順。
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe(`${BASE}/accounts/acc-1/observation`);
    const post = requests[1];
    expect(post?.method).toBe("POST");
    expect(post?.url).toBe(`${BASE}/accounts/acc-1/agent-decisions`);
    const body = post?.body as {
      agentProfileId: string;
      rationale: string;
      actions: { kind: string }[];
    };
    expect(body.agentProfileId).toBe("agent-1");
    expect(body.rationale.length).toBeGreaterThan(0);
    expect(body.actions).toEqual([
      expect.objectContaining({ kind: "HOLD" }),
    ]);
  });

  it("does not submit when rationale is empty (audit trail required)", async () => {
    const { fetch, requests } = makeFakeFetch(defaultRoutes);
    const api = new ApiClient({ baseUrl: BASE, fetch });
    const outcome = await runAgentLoop(
      { api, provider: fakeProvider({ rationale: "   ", actions: [] }) },
      baseParams,
    );
    expect(outcome.status).toBe("skipped");
    // 観測は取りに行くが、発注 POST はしない。
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("caps ordering actions to maxActionsPerLoop and drops the rest", async () => {
    const { fetch, requests } = makeFakeFetch(defaultRoutes);
    const api = new ApiClient({ baseUrl: BASE, fetch });
    const actions = [
      { kind: "ORDER" as const, order: buyOrderCommand },
      { kind: "ORDER" as const, order: buyOrderCommand },
      { kind: "ORDER" as const, order: buyOrderCommand },
    ];
    const outcome = await runAgentLoop(
      { api, provider: fakeProvider({ rationale: "buy three", actions }) },
      { ...baseParams, maxActionsPerLoop: 2 },
    );

    expect(outcome.status).toBe("submitted");
    if (outcome.status === "submitted") {
      expect(outcome.submittedActions).toBe(2);
      expect(outcome.droppedActions).toBe(1);
    }
    const post = requests.find((r) => r.method === "POST");
    const body = post?.body as { actions: unknown[] };
    expect(body.actions).toHaveLength(2);
  });

  it("passes the observation as inputContext for the audit trail", async () => {
    const { fetch, requests } = makeFakeFetch(defaultRoutes);
    const api = new ApiClient({ baseUrl: BASE, fetch });
    await runAgentLoop(
      { api, provider: new HoldDecisionProvider() },
      baseParams,
    );
    const post = requests.find((r) => r.method === "POST");
    const body = post?.body as { inputContext: { source: string } };
    expect(body.inputContext.source).toBe("agent-runner");
  });
});

describe("capActions", () => {
  it("keeps HOLD actions without counting them against the limit", () => {
    const { kept, dropped } = capActions(
      [
        { kind: "HOLD" },
        { kind: "ORDER", order: buyOrderCommand },
        { kind: "HOLD" },
      ],
      1,
    );
    expect(dropped).toBe(0);
    expect(kept).toHaveLength(3);
  });

  it("drops ordering actions beyond the limit but keeps trailing HOLDs", () => {
    const { kept, dropped } = capActions(
      [
        { kind: "ORDER", order: buyOrderCommand },
        { kind: "CANCEL", orderId: "ord-9" },
        { kind: "HOLD" },
      ],
      1,
    );
    expect(dropped).toBe(1);
    // 先頭の ORDER と末尾の HOLD は残り、超過 CANCEL のみ捨てられる。
    expect(kept.map((a) => a.kind)).toEqual(["ORDER", "HOLD"]);
  });
});
