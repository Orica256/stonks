import { describe, expect, it } from "vitest";
import { loadRunnerConfig } from "./config.js";

/**
 * 設定の単体テスト。重点:
 *  - 既定が控えめ（disabled・1 日 1 回・HOLD プロバイダ）であること（§8/§9）
 *  - env で有効化・頻度・上限・口座/プロファイルを上書きできること
 *  - 秘密情報を載せないこと（型上 LLM キーは存在しない）
 */
describe("loadRunnerConfig", () => {
  it("defaults are conservative (disabled, daily cron, hold provider)", () => {
    const cfg = loadRunnerConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.provider).toBe("hold");
    expect(cfg.cron).toBe("0 0 * * *");
    expect(cfg.maxActionsPerLoop).toBe(3);
    expect(cfg.scheduleEnabled).toBe(true);
    expect(cfg.apiBaseUrl).toBe("http://localhost:3001");
    expect(cfg.accountId).toBe("");
    expect(cfg.agentProfileId).toBe("");
  });

  it("derives api base url from API_PORT when explicit base is unset", () => {
    const cfg = loadRunnerConfig({ API_PORT: "4000" });
    expect(cfg.apiBaseUrl).toBe("http://localhost:4000");
  });

  it("strips trailing slash from explicit base url", () => {
    const cfg = loadRunnerConfig({
      AGENT_RUNNER_API_BASE_URL: "http://api.test/",
    });
    expect(cfg.apiBaseUrl).toBe("http://api.test");
  });

  it("honors overrides for enable / cron / limits / account / profile", () => {
    const cfg = loadRunnerConfig({
      AGENT_RUNNER_ENABLED: "true",
      AGENT_RUNNER_PROVIDER: "llm",
      AGENT_RUNNER_CRON: "*/30 9-15 * * 1-5",
      AGENT_RUNNER_MAX_ACTIONS: "5",
      AGENT_RUNNER_ACCOUNT_ID: "acc-1",
      AGENT_RUNNER_PROFILE_ID: "agent-1",
      AGENT_LLM_MODEL: "claude-test",
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.provider).toBe("llm");
    expect(cfg.cron).toBe("*/30 9-15 * * 1-5");
    expect(cfg.maxActionsPerLoop).toBe(5);
    expect(cfg.accountId).toBe("acc-1");
    expect(cfg.agentProfileId).toBe("agent-1");
    expect(cfg.model).toBe("claude-test");
  });

  it("falls back to hold for unknown provider values", () => {
    expect(loadRunnerConfig({ AGENT_RUNNER_PROVIDER: "gpt" }).provider).toBe(
      "hold",
    );
  });
});
