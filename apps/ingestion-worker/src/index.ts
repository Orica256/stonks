/**
 * @stonks/ingestion-worker — BullMQ による価格取込ワーカー（spec §4.1）。
 *
 * market-data の Provider IF 経由でスケジュール取込・バックフィルを行い、
 * db リポジトリへ永続化する。外部 API はこのアプリから直接叩かず、必ず
 * market-data のアダプタ層に委譲する（CLAUDE.md §4）。
 */
export { loadWorkerConfig } from "./config.js";
export type { WorkerConfig } from "./config.js";
export {
  JOB,
  QUEUE_NAME,
  BackfillBarsPayload,
  PollQuotePayload,
  FetchFxRatePayload,
} from "./jobs.js";
export type { JobName } from "./jobs.js";
export {
  handleBackfillBars,
  handlePollQuote,
  handleFetchFxRate,
} from "./handlers.js";
export type { HandlerDeps, MarketDataPort } from "./handlers.js";
export { dispatch } from "./dispatch.js";
export type { JobLike } from "./dispatch.js";
export { buildSchedule, buildBackfillJobs } from "./scheduler.js";
export type { RepeatableJobSpec } from "./scheduler.js";
export { PrismaIngestionRepository } from "./repository.js";
export type { IngestionRepository } from "./repository.js";
export { createIngestionRuntime } from "./worker.js";
export type { IngestionRuntime, CreateRuntimeOptions } from "./worker.js";
