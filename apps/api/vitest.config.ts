import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

/**
 * apps/api のテスト設定。
 *
 * NestJS の DI はデコレータのメタデータ（design:paramtypes）に依存するため、
 * esbuild ではなく SWC でトランスパイルし emitDecoratorMetadata 相当を有効にする。
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        keepClassNames: true,
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globals: false,
    testTimeout: 20000,
  },
});
