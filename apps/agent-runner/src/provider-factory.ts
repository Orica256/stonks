import type { RunnerConfig } from "./config.js";
import { HoldDecisionProvider, type DecisionProvider } from "./decision-provider.js";
import { LlmDecisionProvider } from "./llm-decision-provider.js";

/**
 * config から DecisionProvider を選択する。
 *
 * 既定（provider=hold）は無 LLM・無課金の安全プロバイダ。provider=llm を選ぶと実 LLM
 * 呼び出し（課金）を行う {@link LlmDecisionProvider} に差し替える。ただし API キー
 * （env `ANTHROPIC_API_KEY`）が無い場合は llm を選ばず HOLD にフォールバックする
 * （誤って未認証呼び出し・暴走しないように。spec §8/§9）。
 *
 * LLM キーは Anthropic SDK が env から自動解決するため、このファクトリでは「存在判定」
 * のみに使い、鍵の値を RunnerConfig・ログに載せない（apps/api / ingestion-worker と同方針）。
 */
export const createDecisionProvider = (
  config: RunnerConfig,
  logger: Pick<Console, "info" | "warn" | "error"> = console,
  env: Record<string, string | undefined> = process.env,
): DecisionProvider => {
  if (config.provider === "llm") {
    const hasKey = (env.ANTHROPIC_API_KEY ?? "").trim() !== "";
    if (!hasKey) {
      logger.warn?.(
        "[agent-runner] provider=llm requested but ANTHROPIC_API_KEY is unset; falling back to HOLD (no trade, no LLM call)",
      );
      return new HoldDecisionProvider();
    }
    logger.info?.(
      `[agent-runner] using LLM DecisionProvider (model=${config.model}); LLM usage is billed separately (spec §2.7)`,
    );
    return new LlmDecisionProvider({ logger });
  }
  return new HoldDecisionProvider();
};
