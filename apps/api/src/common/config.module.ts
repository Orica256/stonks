import { Global, Module } from "@nestjs/common";
import { TOKENS } from "./tokens.js";
import { type AppConfig, loadConfig } from "./config.js";

/**
 * AppConfig をアプリ全体に供給する Global モジュール。
 * env からの設定読み込みを 1 箇所に集約し、各モジュールは TOKENS.AppConfig で注入する。
 */
@Global()
@Module({
  providers: [
    {
      provide: TOKENS.AppConfig,
      useFactory: (): AppConfig => loadConfig(),
    },
  ],
  exports: [TOKENS.AppConfig],
})
export class ConfigModule {}
