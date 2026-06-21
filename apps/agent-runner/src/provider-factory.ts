import type { RunnerConfig } from "./config.js";
import { HoldDecisionProvider, type DecisionProvider } from "./decision-provider.js";

/**
 * config から DecisionProvider を選択する。
 *
 * 既定（provider=hold）は無 LLM・無課金の安全プロバイダ。provider=llm を選ぶと実 LLM
 * 呼び出し（課金）を行う実装に差し替える想定だが、その実装はまだ未提供のため、
 * 現状は警告して HOLD にフォールバックする（誤って課金/暴走しないように。spec §8/§9）。
 *
 * LLM 実装を追加する際は env（ANTHROPIC_API_KEY 等）をこのファクトリ内でのみ読み、
 * 秘密情報を RunnerConfig に載せない（apps/api / ingestion-worker と同方針）。
 */
export const createDecisionProvider = (
  config: RunnerConfig,
  logger: Pick<Console, "info" | "warn"> = console,
): DecisionProvider => {
  if (config.provider === "llm") {
    logger.warn?.(
      "[agent-runner] provider=llm requested but no LLM DecisionProvider is wired yet; falling back to HOLD (no trade, no LLM cost)",
    );
  }
  return new HoldDecisionProvider();
};
