import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * apps/web のテスト設定。
 * UI/フックは jsdom 環境で、API クライアントはフェイク fetch に対してテストする。
 */
export default defineConfig({
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
