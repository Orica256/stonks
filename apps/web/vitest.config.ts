import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * apps/web のテスト設定。
 * UI/フックは jsdom 環境で、API クライアントはフェイク fetch に対してテストする。
 */
export default defineConfig({
  // Next と同じく自動 JSX ランタイムを使う（テストで React を明示 import しなくてよい）。
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
