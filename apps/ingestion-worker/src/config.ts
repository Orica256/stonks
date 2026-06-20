import type { Timeframe } from "@stonks/contracts";

/**
 * env から導出する取込ワーカー設定。
 *
 * 秘密情報（プロバイダ API キー）はここで保持せず、createMarketDataProvider に
 * env をそのまま渡して露出を最小化する（apps/api と同方針）。
 */
export interface WorkerConfig {
  /** Redis 接続 URL（BullMQ）。 */
  redisUrl: string;
  /** 同時実行ジョブ数（無料 API レート制御は market-data 側だが二重防御で控えめに）。 */
  concurrency: number;
  /** スケジュールを有効にするか（false なら consumer のみ。手動 enqueue 用）。 */
  scheduleEnabled: boolean;
  /** 最新気配ポーリングの cron（既定: 平日 9-23時に5分毎）。 */
  pollQuoteCron: string;
  /** 日足バックフィルの cron（既定: 毎日 21:00 UTC ≒ 米国引け後）。 */
  dailyBarsCron: string;
  /** FX 取得の cron（既定: 1時間毎）。 */
  fxCron: string;
  /** スケジュール対象の銘柄ユニバース（カンマ区切り EXCHANGE:SYMBOL）。 */
  universe: string[];
  /** バックフィルで埋める足種。 */
  backfillTimeframe: Timeframe;
  /** バックフィルの遡及日数。 */
  backfillDays: number;
}

const parseIntOr = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const parseList = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const parseBool = (raw: string | undefined, fallback: boolean): boolean => {
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
};

/** プロセス環境（または注入された env）からワーカー設定を構築する。 */
export const loadWorkerConfig = (
  env: Record<string, string | undefined> = process.env,
): WorkerConfig => ({
  redisUrl: env.REDIS_URL?.trim() || "redis://localhost:6379",
  concurrency: parseIntOr(env.INGEST_CONCURRENCY, 2),
  scheduleEnabled: parseBool(env.INGEST_SCHEDULE_ENABLED, true),
  pollQuoteCron: env.INGEST_POLL_QUOTE_CRON?.trim() || "*/5 9-23 * * 1-5",
  dailyBarsCron: env.INGEST_DAILY_BARS_CRON?.trim() || "0 21 * * *",
  fxCron: env.INGEST_FX_CRON?.trim() || "0 * * * *",
  universe: parseList(env.INGEST_UNIVERSE),
  backfillTimeframe: "1d",
  backfillDays: parseIntOr(env.INGEST_BACKFILL_DAYS, 365),
});
