import { getPrisma } from "@stonks/db";
import { createMarketDataProvider } from "@stonks/market-data";
import { loadWorkerConfig } from "./config.js";
import { PrismaIngestionRepository } from "./repository.js";
import { createIngestionRuntime } from "./worker.js";
import type { MarketDataPort } from "./handlers.js";

/**
 * apps/ingestion-worker のエントリポイント。
 *
 * 実構成を組み立てて BullMQ consumer を起動する:
 *   - market-data: env から実アダプタ構成のレジストリ（外部 API はこの内側のみ）
 *   - db: Prisma で OHLCV / Quote / FxRate を永続化
 *   - BullMQ: スケジュール登録 + ブートストラップ・バックフィル
 * SIGINT/SIGTERM でグレースフルに停止する。
 */
const main = async (): Promise<void> => {
  const config = loadWorkerConfig(process.env);
  const market = createMarketDataProvider({ env: process.env }) as MarketDataPort;
  const repo = new PrismaIngestionRepository(getPrisma());

  const runtime = createIngestionRuntime({
    config,
    deps: { market, repo, logger: console },
  });

  await runtime.registerSchedules();
  await runtime.enqueueBackfill();

  console.info(
    `[ingestion] worker started (queue=ingestion, concurrency=${config.concurrency}, universe=${config.universe.length})`,
  );

  let closing = false;
  const stop = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.info(`[ingestion] received ${signal}`);
    runtime
      .shutdown()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        console.error("[ingestion] shutdown error", err);
        process.exit(1);
      });
  };

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
};

main().catch((err: unknown) => {
  console.error("[ingestion] fatal startup error", err);
  process.exit(1);
});
