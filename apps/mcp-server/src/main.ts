import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./api-client.js";
import { loadMcpConfig } from "./config.js";
import { createMcpServer } from "./server.js";

/**
 * apps/mcp-server のエントリポイント（spec §6.7）。
 *
 * apps/api(HTTP) の薄いラッパとして売買/参照ツールを stdio トランスポートで公開する。
 * LLM（Claude Code 等）は自身のセッションからこのプロセスを起動し、ツールを呼ぶ。
 * ドメイン・DB は持たず、すべて API 経由（spec §4.3 / §8）。
 *
 * stdout は MCP の JSON-RPC 専用。ログは stderr に出す（プロトコルを壊さないため）。
 */
const main = async (): Promise<void> => {
  const config = loadMcpConfig(process.env);

  const api = new ApiClient({
    baseUrl: config.apiBaseUrl,
    fetch: globalThis.fetch as never,
    timeoutMs: config.requestTimeoutMs,
  });

  const server = createMcpServer({
    api,
    defaultAgentProfileId: config.defaultAgentProfileId,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `[mcp-server] connected (stdio) → api=${config.apiBaseUrl}` +
      (config.defaultAgentProfileId
        ? ` defaultAgent=${config.defaultAgentProfileId}`
        : " (no default agent profile; place_order requires agentProfileId)"),
  );

  const stop = (signal: string): void => {
    console.error(`[mcp-server] received ${signal}, shutting down`);
    server
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
};

main().catch((err: unknown) => {
  console.error("[mcp-server] fatal startup error", err);
  process.exit(1);
});
