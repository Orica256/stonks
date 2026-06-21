import { ApiClient } from "./api-client.js";
import { loadRunnerConfig } from "./config.js";
import { createDecisionProvider } from "./provider-factory.js";
import { createAgentRunnerRuntime } from "./runtime.js";

/**
 * apps/agent-runner のエントリポイント（spec §2.7 P1 自律エージェントループ）。
 *
 * BullMQ で定期実行し、市況/保有/成績の観測を LLM(DecisionProvider) に渡して売買判断を
 * 自動執行する。発注・観測・成績取得はすべて apps/api(HTTP) 経由で、ドメイン・DB は
 * 持たない（spec §4.3）。enabled=false（既定）なら何もスケジュールしない（§9 暴走防止）。
 *
 * 注意: provider=llm を有効化すると LLM 呼び出し料が発生する（§2.7 コスト注記）。
 * 既定は控えめ（disabled・1 日 1 回・無 LLM の HOLD プロバイダ）。
 *
 * SIGINT/SIGTERM でグレースフルに停止する。
 */
const main = async (): Promise<void> => {
  const config = loadRunnerConfig(process.env);

  const api = new ApiClient({
    baseUrl: config.apiBaseUrl,
    fetch: globalThis.fetch as never,
    timeoutMs: config.requestTimeoutMs,
  });
  const provider = createDecisionProvider(config, console);

  const runtime = createAgentRunnerRuntime({
    config,
    api,
    provider,
    logger: console,
  });

  await runtime.registerSchedules();

  console.info(
    `[agent-runner] started (queue=agent-runner, api=${config.apiBaseUrl}, ` +
      `enabled=${config.enabled}, provider=${config.provider}, model=${config.model}, ` +
      `cron="${config.cron}", maxActions=${config.maxActionsPerLoop})`,
  );
  if (!config.enabled) {
    console.info(
      "[agent-runner] loop is DISABLED; set AGENT_RUNNER_ENABLED=true to activate (LLM cost applies for provider=llm)",
    );
  }

  let closing = false;
  const stop = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.info(`[agent-runner] received ${signal}`);
    runtime
      .shutdown()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        console.error("[agent-runner] shutdown error", err);
        process.exit(1);
      });
  };

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
};

main().catch((err: unknown) => {
  console.error("[agent-runner] fatal startup error", err);
  process.exit(1);
});
