/**
 * env から導出する MCP サーバー設定。
 *
 * mcp-server は apps/api(HTTP) の薄いラッパであり、ドメインや DB を直接持たない。
 * ここで保持するのは「どの API を叩くか」と「発注時の既定エージェント」だけで、
 * 秘密情報（LLM キー等）は扱わない（spec §4.3 / §6.7）。
 */
export interface McpConfig {
  /** apps/api のベース URL（末尾スラッシュ無し）。全ツールはこの API を叩く。 */
  apiBaseUrl: string;
  /**
   * place_order がツール引数で agentProfileId を渡されなかった場合の既定値。
   * 監査証跡（AgentDecision）は agentProfileId 必須のため、どちらかが必要。
   */
  defaultAgentProfileId: string | undefined;
  /** API 呼び出しのタイムアウト（ms）。 */
  requestTimeoutMs: number;
}

const parseIntOr = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

/** プロセス環境（または注入された env）から MCP サーバー設定を構築する。 */
export const loadMcpConfig = (
  env: Record<string, string | undefined> = process.env,
): McpConfig => {
  const base =
    env.MCP_API_BASE_URL?.trim() ||
    `http://localhost:${env.API_PORT?.trim() || "3001"}`;
  return {
    apiBaseUrl: trimTrailingSlash(base),
    defaultAgentProfileId: env.MCP_DEFAULT_AGENT_PROFILE_ID?.trim() || undefined,
    requestTimeoutMs: parseIntOr(env.MCP_REQUEST_TIMEOUT_MS, 15000),
  };
};
