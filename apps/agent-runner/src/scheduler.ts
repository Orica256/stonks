import type { RunnerConfig } from "./config.js";
import { JOB, type RunLoopPayload } from "./jobs.js";

/**
 * 繰り返しジョブ（repeatable / cron）の定義。
 *
 * 実 Redis に依存せず、設定からスケジュールを純粋に組み立てられるようにする
 * （単体テスト可能）。runtime 側がこれを BullMQ の repeatable job として登録する。
 */
export interface RepeatableJobSpec {
  name: string;
  data: RunLoopPayload;
  /** BullMQ repeat オプション（cron）。 */
  cron: string;
  /** 同一スケジュールの重複登録を避ける安定キー。 */
  jobId: string;
}

/**
 * 設定から自律ループの cron ジョブを構築する。
 *
 * enabled=false、または accountId / agentProfileId 未設定なら空配列を返し、
 * 何もスケジュールしない（暴走防止・誤起動防止。spec §9）。
 */
export const buildSchedule = (cfg: RunnerConfig): RepeatableJobSpec[] => {
  if (!cfg.enabled) return [];
  if (!cfg.accountId || !cfg.agentProfileId) return [];

  return [
    {
      name: JOB.RunLoop,
      data: { accountId: cfg.accountId, agentProfileId: cfg.agentProfileId },
      cron: cfg.cron,
      jobId: `run-loop:${cfg.accountId}:${cfg.agentProfileId}`,
    },
  ];
};
