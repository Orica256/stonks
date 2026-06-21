import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import type { RunnerConfig } from "./config.js";
import type { DecisionProvider } from "./decision-provider.js";
import type { ApiClient } from "./api-client.js";
import { JOB, QUEUE_NAME, type RunLoopPayload } from "./jobs.js";
import { runAgentLoop } from "./loop.js";
import { buildSchedule } from "./scheduler.js";

/**
 * BullMQ consumer の組み立てとライフサイクル管理（spec §2.7 P1, §4.1）。
 *
 * ランナーはスケジューリングに徹し、発注・観測・成績取得はすべて ApiClient(HTTP) 経由
 * （ドメイン・DB を持たない。spec §4.3）。LLM 判断は DecisionProvider に注入する。
 * Redis 接続・cron 登録・グレースフルシャットダウンをここで面倒見る。
 */
export interface AgentRunnerRuntime {
  queue: Queue;
  worker: Worker;
  /** repeatable ジョブを登録する（enabled かつ scheduleEnabled 時のみ意味がある）。 */
  registerSchedules: () => Promise<void>;
  /** Worker → Queue → Redis の順に安全に閉じる。 */
  shutdown: () => Promise<void>;
}

export interface CreateRuntimeOptions {
  config: RunnerConfig;
  api: ApiClient;
  provider: DecisionProvider;
  /** 接続を DI したい場合（テスト等）。未指定なら redisUrl から生成。 */
  connection?: ConnectionOptions;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

/** BullMQ の Queue / Worker を生成して自律ループランタイムを構築する。 */
export const createAgentRunnerRuntime = (
  opts: CreateRuntimeOptions,
): AgentRunnerRuntime => {
  const { config, api, provider } = opts;
  const log = opts.logger ?? console;
  const connection: ConnectionOptions =
    opts.connection ?? ({ url: config.redisUrl } as ConnectionOptions);

  const queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      // 自律ループは冪等でないため再試行は控えめ（重複発注を避ける）。
      attempts: 1,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1000 },
    },
  });

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job): Promise<unknown> => {
      if (job.name !== JOB.RunLoop) {
        log.warn?.(`[agent-runner] unknown job ${job.name}; ignoring`);
        return undefined;
      }
      const payload = job.data as RunLoopPayload;
      return runAgentLoop(
        { api, provider, logger: log },
        {
          accountId: payload.accountId,
          agentProfileId: payload.agentProfileId,
          model: config.model,
          enabled: config.enabled,
          maxActionsPerLoop: config.maxActionsPerLoop,
        },
      );
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    log.warn?.(
      `[agent-runner] job ${job?.name ?? "?"}#${job?.id ?? "?"} failed: ${err.message}`,
    );
  });
  worker.on("error", (err) => {
    log.error?.(`[agent-runner] worker error: ${err.message}`);
  });

  const registerSchedules = async (): Promise<void> => {
    if (!config.scheduleEnabled) {
      log.info?.("[agent-runner] schedule disabled (consumer only)");
      return;
    }
    const specs = buildSchedule(config);
    if (specs.length === 0) {
      log.info?.(
        "[agent-runner] no schedules (loop disabled or account/profile unset)",
      );
      return;
    }
    for (const spec of specs) {
      await queue.add(spec.name, spec.data, {
        repeat: { pattern: spec.cron },
        jobId: spec.jobId,
      });
    }
    log.info?.(`[agent-runner] registered ${specs.length} repeatable job(s)`);
  };

  const shutdown = async (): Promise<void> => {
    log.info?.("[agent-runner] shutting down…");
    await worker.close();
    await queue.close();
  };

  return { queue, worker, registerSchedules, shutdown };
};
