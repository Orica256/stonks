import { DomainError } from "@stonks/contracts";
import {
  BackfillBarsPayload,
  FetchFxRatePayload,
  IngestIntradayBarsPayload,
  JOB,
  PollQuotePayload,
} from "./jobs.js";
import {
  handleBackfillBars,
  handleFetchFxRate,
  handleIngestIntradayBars,
  handlePollQuote,
  type HandlerDeps,
} from "./handlers.js";

/** ジョブの最小表現（BullMQ Job と互換。テストではプレーンオブジェクトで渡す）。 */
export interface JobLike {
  name: string;
  data: unknown;
}

/**
 * ジョブ名でハンドラへディスパッチする。
 *
 * ペイロードは対応する Zod スキーマで検証してから渡す（不正データを早期に弾く）。
 * 未知のジョブ名は VALIDATION エラー。BullMQ Worker のプロセッサ本体に使う。
 */
export const dispatch = async (
  deps: HandlerDeps,
  job: JobLike,
): Promise<unknown> => {
  switch (job.name) {
    case JOB.BackfillBars:
      return handleBackfillBars(deps, BackfillBarsPayload.parse(job.data));
    case JOB.IngestIntradayBars:
      return handleIngestIntradayBars(
        deps,
        IngestIntradayBarsPayload.parse(job.data),
      );
    case JOB.PollQuote:
      return handlePollQuote(deps, PollQuotePayload.parse(job.data));
    case JOB.FetchFxRate:
      return handleFetchFxRate(deps, FetchFxRatePayload.parse(job.data));
    default:
      throw new DomainError(
        "VALIDATION",
        `unknown ingestion job: ${job.name}`,
      );
  }
};
