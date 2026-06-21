import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { DomainExceptionFilter } from "./common/domain-exception.filter.js";
import { loadConfig } from "./common/config.js";

/**
 * apps/api エントリポイント。NestJS アプリを起動し REST/SSE を公開する。
 * 秘密情報（API キー）はログに出さない（CLAUDE.md §7）。
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

  const config = loadConfig();
  await app.listen(config.port);
  console.log(`stonks api listening on :${config.port}`);
}

void bootstrap();
