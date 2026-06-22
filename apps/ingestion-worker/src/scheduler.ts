import type { WorkerConfig } from "./config.js";
import {
  JOB,
  type BackfillBarsPayload,
  type FetchFxRatePayload,
  type IngestIntradayBarsPayload,
  type PollQuotePayload,
} from "./jobs.js";

/**
 * 繰り返しジョブ（repeatable / cron）の定義。
 *
 * 実 Redis に依存せず、設定からスケジュール群を純粋に組み立てられるようにする
 * （単体テスト可能）。worker 側がこれを BullMQ の repeatable job として登録する。
 */
export interface RepeatableJobSpec {
  name: string;
  data:
    | PollQuotePayload
    | FetchFxRatePayload
    | IngestIntradayBarsPayload
    | (BackfillBarsPayload & { from: string; to: string });
  /** BullMQ repeat オプション（cron）。jobId は重複登録防止に使う。 */
  cron: string;
  /** 同一スケジュールの重複登録を避ける安定キー。 */
  jobId: string;
}

/**
 * 設定からスケジュール（cron）ジョブ一覧を構築する。
 *
 * - 銘柄ユニバースの各銘柄に対し最新気配ポーリングを登録。
 * - 各銘柄 × 設定の分足足種に対し分足取込（ローリング）を登録。
 * - FX(USD/JPY) 取得を 1 件登録。
 * - 日足バックフィルは初回ブートストラップ向けに別途 enqueue するため、
 *   ここでは cron 登録しない（毎日の差分取込は PollQuote/別運用に委譲）。
 */
export const buildSchedule = (cfg: WorkerConfig): RepeatableJobSpec[] => {
  const specs: RepeatableJobSpec[] = [];

  for (const instrumentId of cfg.universe) {
    specs.push({
      name: JOB.PollQuote,
      data: { instrumentId, force: false },
      cron: cfg.pollQuoteCron,
      jobId: `poll-quote:${instrumentId}`,
    });
  }

  // 分足 OHLCV 取込（1m/5m/15m/1h）。銘柄 × 足種ごとに repeatable で登録し、
  // ハンドラが実行時刻から lookback 分のローリングウィンドウを取り込む。
  for (const instrumentId of cfg.universe) {
    for (const timeframe of cfg.intradayTimeframes) {
      specs.push({
        name: JOB.IngestIntradayBars,
        data: {
          instrumentId,
          timeframe,
          lookbackMinutes: cfg.intradayLookbackMinutes,
          force: false,
        },
        cron: cfg.intradayBarsCron,
        jobId: `ingest-intraday-bars:${instrumentId}:${timeframe}`,
      });
    }
  }

  specs.push({
    name: JOB.FetchFxRate,
    data: { base: "USD", quote: "JPY" },
    cron: cfg.fxCron,
    jobId: "fetch-fx-rate:USD-JPY",
  });

  return specs;
};

/**
 * ブートストラップ用の単発バックフィルジョブを構築する。
 *
 * 各銘柄について「now から backfillDays 遡った日足」を埋める単発ジョブを返す。
 * 起動時に一度だけ enqueue してヒストリカルを確保する想定。
 */
export const buildBackfillJobs = (
  cfg: WorkerConfig,
  now: Date = new Date(),
): { name: string; data: BackfillBarsPayload }[] => {
  const to = now.toISOString();
  const from = new Date(
    now.getTime() - cfg.backfillDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  return cfg.universe.map((instrumentId) => ({
    name: JOB.BackfillBars,
    data: {
      instrumentId,
      timeframe: cfg.backfillTimeframe,
      from,
      to,
    },
  }));
};
