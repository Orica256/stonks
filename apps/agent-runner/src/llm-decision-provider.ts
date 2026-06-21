import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AgentAction, type AgentObservation } from "@stonks/contracts";
import type { DecisionProvider, DecisionResult } from "./decision-provider.js";

/**
 * 実 LLM（Anthropic Claude）による判断プロバイダ（spec §2.7 P1）。
 *
 * 観測（市況/保有/成績の要約）を Anthropic Messages API に渡し、BUY/SELL(=ORDER)/
 * CANCEL/HOLD と rationale を JSON で受け取って contracts スキーマで検証する。
 * 非ストリーミング・ツールなしのテキスト補完のみを使う。
 *
 * 安全側設計（spec §8/§9 暴走防止）:
 *  - 応答が壊れている / スキーマ不一致 / API エラー / API キー無しのときは必ず HOLD に倒す
 *    （発注せず、ループは継続する）。例外を上位に投げない。
 *  - rationale は監査証跡に必須のため、HOLD でも非空文字列を返す。
 *  - API キーは SDK が env `ANTHROPIC_API_KEY` から自動解決する。RunnerConfig・ログ・
 *    コミットに鍵を載せない。
 *
 * 注意: 呼び出しごとに LLM 利用料が発生する（§2.7 コスト注記。アプリのインフラ無料制約とは別枠）。
 */

/** Anthropic Messages API の最小 IF（テストでフェイク差し替え可能にする）。 */
export interface MessagesClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

export interface LlmDecisionProviderDeps {
  /** Anthropic クライアント（既定: new Anthropic()。env からキー自動解決）。 */
  client?: MessagesClient;
  /** 応答の最大トークン。 */
  maxTokens?: number;
  logger?: Pick<Console, "warn" | "error">;
}

/** LLM 応答の JSON 形（contracts の AgentAction を再利用）。 */
const LlmResponse = z.object({
  rationale: z.string().min(1),
  actions: z.array(AgentAction).default([]),
});

const DEFAULT_MAX_TOKENS = 16000;

const SYSTEM_PROMPT = [
  "You are a paper-trading (simulation) agent. This is NOT investment advice and",
  "is NOT connected to real money or a real broker. Given an account observation",
  "(cash, positions, recent quotes) you decide trading actions.",
  "",
  "Respond with ONLY a single JSON object (no markdown, no code fence, no prose) of shape:",
  '{ "rationale": string, "actions": Action[] }',
  "where each Action is one of:",
  '  { "kind": "ORDER", "order": { "accountId": string, "instrumentId": string,',
  '      "side": "BUY"|"SELL", "type": "MARKET"|"LIMIT"|"STOP"|"STOP_LIMIT",',
  '      "quantity": number, "limitPrice"?: string, "stopPrice"?: string,',
  '      "timeInForce"?: "DAY"|"GTC" } }',
  '  { "kind": "CANCEL", "orderId": string }',
  '  { "kind": "HOLD", "note"?: string }',
  "",
  "Rules:",
  "- rationale is REQUIRED and must be a non-empty explanation of your decision (audit trail).",
  '- Use the accountId from the observation for any ORDER. quantity must be > 0.',
  "- LIMIT/STOP_LIMIT require limitPrice; STOP/STOP_LIMIT require stopPrice; MARKET must omit limitPrice.",
  "- Prices are decimal strings (e.g. \"123.45\").",
  '- If you do not want to trade, return a single HOLD action.',
  "- Be conservative; do not over-trade.",
].join("\n");

/** res.content の text ブロックを連結して取り出す。 */
const extractText = (content: Array<{ type: string; text?: string }>): string =>
  content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");

/** 余分なコードフェンス等を剥がして最初の JSON オブジェクトを取り出す。 */
const extractJson = (text: string): string => {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return trimmed;
  return trimmed.slice(start, end + 1);
};

const buildUserPrompt = (
  observation: AgentObservation,
  strategyPrompt?: string,
): string => {
  const obs = JSON.stringify(observation);
  if (strategyPrompt && strategyPrompt.trim() !== "") {
    return `Strategy guidance:\n${strategyPrompt.trim()}\n\nObservation:\n${obs}`;
  }
  return `Observation:\n${obs}`;
};

const holdFallback = (reason: string, asOf: string): DecisionResult => ({
  rationale: `LlmDecisionProvider fallback to HOLD: ${reason}`,
  actions: [{ kind: "HOLD", note: `asOf=${asOf}` }],
});

export class LlmDecisionProvider implements DecisionProvider {
  private readonly client: MessagesClient;
  private readonly maxTokens: number;
  private readonly logger: Pick<Console, "warn" | "error">;

  constructor(deps: LlmDecisionProviderDeps = {}) {
    // 既定クライアントは env(ANTHROPIC_API_KEY) からキーを自動解決する。
    this.client = deps.client ?? (new Anthropic() as unknown as MessagesClient);
    this.maxTokens = deps.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.logger = deps.logger ?? console;
  }

  async decide(input: {
    observation: AgentObservation;
    model: string;
    strategyPrompt?: string;
  }): Promise<DecisionResult> {
    const asOf = input.observation.asOf;
    let raw: { content: Array<{ type: string; text?: string }> };
    try {
      raw = await this.client.messages.create({
        // モデル ID はそのまま渡す（日付サフィックス付与禁止）。
        model: input.model,
        max_tokens: this.maxTokens,
        // temperature/top_p/budget_tokens は付けない（Opus 4.8 で 400）。
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildUserPrompt(input.observation, input.strategyPrompt),
          },
        ],
      });
    } catch (err) {
      // SDK の型付き例外（RateLimitError/APIError 等）。発注せず HOLD で継続（暴走防止）。
      const reason =
        err instanceof Anthropic.APIError
          ? `Anthropic API error (status=${err.status ?? "?"})`
          : "LLM call failed";
      this.logger.error?.(`[agent-runner] ${reason}`, err);
      return holdFallback(reason, asOf);
    }

    const text = extractText(raw.content);
    if (text.trim() === "") {
      this.logger.warn?.("[agent-runner] empty LLM response; holding");
      return holdFallback("empty LLM response", asOf);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractJson(text));
    } catch {
      this.logger.warn?.(
        "[agent-runner] LLM response was not valid JSON; holding",
      );
      return holdFallback("invalid JSON in LLM response", asOf);
    }

    const result = LlmResponse.safeParse(parsedJson);
    if (!result.success) {
      this.logger.warn?.(
        `[agent-runner] LLM response failed schema validation; holding (${result.error.issues.length} issue(s))`,
      );
      return holdFallback("LLM response failed schema validation", asOf);
    }

    return { rationale: result.data.rationale, actions: result.data.actions };
  }
}
