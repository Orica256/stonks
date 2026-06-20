import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import type { WorkerConfig } from "./config.js";
import { QUEUE_NAME } from "./jobs.js";
import { dispatch, type JobLike } from "./dispatch.js";
import type { HandlerDeps } from "./handlers.js";
import { buildBackfillJobs, buildSchedule } from "./scheduler.js";

/**
 * BullMQ consumer の組み立てとライフサイクル管理。
 *
 * ワーカーはスケジューリングと永続化トリガに徹し、外部 API は HandlerDeps.market
 * （market-data の Provider IF）経由でのみ叩く。Redis 接続・cron 登録・
 * グレースフルシャットダウンをここで面倒見る。
 */
export interface IngestionRuntime {
  queue: Queue;
  worker: Worker;
  /** repeatable / bootstrap ジョブを登録する（scheduleEnabled 時のみ意味がある）。 */
  registerSchedules: () => Promise<void>;
  /** ブートストラップのバックフィルを一度だけ enqueue する。 */
  enqueueBackfill: () => Promise<void>;
  /** Worker → Queue → Redis の順に安全に閉じる。 */
  shutdown: () => Promise<void>;
}

export interface CreateRuntimeOptions {
  config: WorkerConfig;
  deps: HandlerDeps;
  /** 接続を DI したい場合（テスト等）。未指定なら redisUrl から生成。 */
  connection?: ConnectionOptions;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

/** BullMQ の Queue / Worker を生成して取込ランタイムを構築する。 */
export const createIngestionRuntime = (
  opts: CreateRuntimeOptions,
): IngestionRuntime => {
  const { config, deps } = opts;
  const log = opts.logger ?? console;
  const connection: ConnectionOptions =
    opts.connection ?? ({ url: config.redisUrl } as ConnectionOptions);

  const queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job): Promise<unknown> => {
      const jobLike: JobLike = { name: job.name, data: job.data };
      return dispatch(deps, jobLike);
    },
    { connection, concurrency: config.concurrency },
  );

  worker.on("failed", (job, err) => {
    log.warn?.(
      `[ingestion] job ${job?.name ?? "?"}#${job?.id ?? "?"} failed: ${err.message}`,
    );
  });
  worker.on("error", (err) => {
    log.error?.(`[ingestion] worker error: ${err.message}`);
  });

  const registerSchedules = async (): Promise<void> => {
    if (!config.scheduleEnabled) {
      log.info?.("[ingestion] schedule disabled (consumer only)");
      return;
    }
    for (const spec of buildSchedule(config)) {
      await queue.add(spec.name, spec.data, {
        repeat: { pattern: spec.cron },
        jobId: spec.jobId,
      });
    }
    log.info?.(
      `[ingestion] registered ${buildSchedule(config).length} repeatable jobs`,
    );
  };

  const enqueueBackfill = async (): Promise<void> => {
    const jobs = buildBackfillJobs(config);
    for (const j of jobs) {
      await queue.add(j.name, j.data);
    }
    if (jobs.length > 0) {
      log.info?.(`[ingestion] enqueued ${jobs.length} backfill jobs`);
    }
  };

  const shutdown = async (): Promise<void> => {
    log.info?.("[ingestion] shutting down…");
    await worker.close();
    await queue.close();
  };

  return { queue, worker, registerSchedules, enqueueBackfill, shutdown };
};
