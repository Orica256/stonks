import { describe, expect, it } from "vitest";
import { loadRunnerConfig } from "./config.js";
import { buildSchedule } from "./scheduler.js";

const enabledCfg = (over: Record<string, string | undefined> = {}) =>
  loadRunnerConfig({
    AGENT_RUNNER_ENABLED: "true",
    AGENT_RUNNER_ACCOUNT_ID: "acc-1",
    AGENT_RUNNER_PROFILE_ID: "agent-1",
    ...over,
  });

/**
 * スケジュール構築の単体テスト（実 Redis 非依存）。重点:
 *  - enabled=false なら何もスケジュールしない（誤起動防止。§9）
 *  - account/profile 未設定なら何もスケジュールしない
 *  - 有効時は cron ジョブを 1 件、安定 jobId で構築する
 */
describe("buildSchedule", () => {
  it("returns no jobs when the loop is disabled", () => {
    const cfg = loadRunnerConfig({
      AGENT_RUNNER_ENABLED: "false",
      AGENT_RUNNER_ACCOUNT_ID: "acc-1",
      AGENT_RUNNER_PROFILE_ID: "agent-1",
    });
    expect(buildSchedule(cfg)).toEqual([]);
  });

  it("returns no jobs when account or profile is unset", () => {
    expect(buildSchedule(enabledCfg({ AGENT_RUNNER_ACCOUNT_ID: "" }))).toEqual(
      [],
    );
    expect(buildSchedule(enabledCfg({ AGENT_RUNNER_PROFILE_ID: "" }))).toEqual(
      [],
    );
  });

  it("builds one repeatable run-loop job with a stable jobId", () => {
    const specs = buildSchedule(enabledCfg({ AGENT_RUNNER_CRON: "0 0 * * *" }));
    expect(specs).toHaveLength(1);
    expect(specs[0]?.name).toBe("run-loop");
    expect(specs[0]?.cron).toBe("0 0 * * *");
    expect(specs[0]?.jobId).toBe("run-loop:acc-1:agent-1");
    expect(specs[0]?.data).toEqual({
      accountId: "acc-1",
      agentProfileId: "agent-1",
    });
  });
});
