import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { AgentObservation } from "@stonks/contracts";
import {
  LlmDecisionProvider,
  type MessagesClient,
} from "./llm-decision-provider.js";

/**
 * LlmDecisionProvider の単体テスト。実 LLM・実ネットワークには一切依存せず、
 * Anthropic SDK の messages.create をフェイク/モックで差し替える（CLAUDE.md §3）。
 *
 * 検証ポイント:
 *  - 正常応答 → contracts スキーマで検証して actions に変換する
 *  - 壊れた応答（非 JSON / スキーマ不一致 / 空）→ HOLD フォールバック（暴走防止）
 *  - API エラー（型付き例外含む）→ HOLD フォールバック＋継続（throw しない）
 */

const observation: AgentObservation = {
  accountId: "acc-1",
  asOf: "2026-06-20T00:00:00.000Z",
  cashByCurrency: { JPY: "1000000" },
  positions: [],
  recentQuotes: [
    { instrumentId: "inst-1", symbol: "7203.T", last: "2500" },
  ],
};

const silentLogger = { warn: vi.fn(), error: vi.fn() };

/** text ブロック 1 つを返すフェイク応答を作る。 */
const textResponse = (text: string) => ({
  content: [{ type: "text", text }],
});

/** create が指定値を返す/throw するフェイククライアントを作る。 */
const fakeClient = (
  impl: () => Promise<{ content: Array<{ type: string; text?: string }> }>,
): { client: MessagesClient; create: ReturnType<typeof vi.fn> } => {
  const create = vi.fn(impl);
  return { client: { messages: { create } }, create };
};

describe("LlmDecisionProvider", () => {
  it("converts a well-formed LLM response into validated actions", async () => {
    const body = JSON.stringify({
      rationale: "Buy a small position in 7203.T on momentum.",
      actions: [
        {
          kind: "ORDER",
          order: {
            accountId: "acc-1",
            instrumentId: "inst-1",
            side: "BUY",
            type: "MARKET",
            quantity: 100,
          },
        },
      ],
    });
    const { client, create } = fakeClient(async () =>
      textResponse(body),
    );
    const provider = new LlmDecisionProvider({ client, logger: silentLogger });

    const result = await provider.decide({
      observation,
      model: "claude-opus-4-8",
    });

    expect(result.rationale).toContain("7203.T");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ kind: "ORDER" });
    // モデル ID をそのまま渡し、temperature 等を付けないこと。
    const args = create.mock.calls[0]?.[0];
    expect(args.model).toBe("claude-opus-4-8");
    expect(args).not.toHaveProperty("temperature");
    expect(args).not.toHaveProperty("top_p");
  });

  it("strips a markdown code fence around the JSON", async () => {
    const fenced =
      '```json\n{ "rationale": "hold for now", "actions": [{ "kind": "HOLD" }] }\n```';
    const { client } = fakeClient(async () => textResponse(fenced));
    const provider = new LlmDecisionProvider({ client, logger: silentLogger });

    const result = await provider.decide({
      observation,
      model: "claude-opus-4-8",
    });

    expect(result.rationale).toBe("hold for now");
    expect(result.actions[0]).toMatchObject({ kind: "HOLD" });
  });

  it("falls back to HOLD when the response is not valid JSON", async () => {
    const { client } = fakeClient(async () =>
      textResponse("I think you should buy some stock!"),
    );
    const provider = new LlmDecisionProvider({ client, logger: silentLogger });

    const result = await provider.decide({
      observation,
      model: "claude-opus-4-8",
    });

    expect(result.actions).toEqual([
      { kind: "HOLD", note: "asOf=2026-06-20T00:00:00.000Z" },
    ]);
    expect(result.rationale).toContain("HOLD");
  });

  it("falls back to HOLD when the JSON fails contract schema validation", async () => {
    // quantity <= 0 は PlaceOrderCommand の refine で弾かれる。
    const body = JSON.stringify({
      rationale: "bad order",
      actions: [
        {
          kind: "ORDER",
          order: {
            accountId: "acc-1",
            instrumentId: "inst-1",
            side: "BUY",
            type: "MARKET",
            quantity: 0,
          },
        },
      ],
    });
    const { client } = fakeClient(async () => textResponse(body));
    const provider = new LlmDecisionProvider({ client, logger: silentLogger });

    const result = await provider.decide({
      observation,
      model: "claude-opus-4-8",
    });

    expect(result.actions[0]).toMatchObject({ kind: "HOLD" });
  });

  it("falls back to HOLD on an empty text response", async () => {
    const { client } = fakeClient(async () => ({ content: [] }));
    const provider = new LlmDecisionProvider({ client, logger: silentLogger });

    const result = await provider.decide({
      observation,
      model: "claude-opus-4-8",
    });

    expect(result.actions[0]).toMatchObject({ kind: "HOLD" });
  });

  it("falls back to HOLD (does not throw) on a generic API error", async () => {
    const { client } = fakeClient(async () => {
      throw new Error("network down");
    });
    const provider = new LlmDecisionProvider({ client, logger: silentLogger });

    const result = await provider.decide({
      observation,
      model: "claude-opus-4-8",
    });

    expect(result.actions[0]).toMatchObject({ kind: "HOLD" });
    expect(result.rationale).toContain("HOLD");
  });

  it("falls back to HOLD on a typed Anthropic API error", async () => {
    const apiErr = new Anthropic.APIError(
      429,
      undefined,
      "rate limited",
      undefined,
    );
    const { client } = fakeClient(async () => {
      throw apiErr;
    });
    const provider = new LlmDecisionProvider({ client, logger: silentLogger });

    const result = await provider.decide({
      observation,
      model: "claude-opus-4-8",
    });

    expect(result.actions[0]).toMatchObject({ kind: "HOLD" });
    expect(result.rationale).toContain("Anthropic API error");
  });

  it("includes the strategy prompt in the user message when provided", async () => {
    const { client, create } = fakeClient(async () =>
      textResponse('{ "rationale": "ok", "actions": [{ "kind": "HOLD" }] }'),
    );
    const provider = new LlmDecisionProvider({ client, logger: silentLogger });

    await provider.decide({
      observation,
      model: "claude-opus-4-8",
      strategyPrompt: "Only trade large-cap names.",
    });

    const userMsg = create.mock.calls[0]?.[0].messages[0].content as string;
    expect(userMsg).toContain("Only trade large-cap names.");
  });
});
