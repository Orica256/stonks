/**
 * env から導出する自律エージェントループ設定（spec §2.7 P1 / §9 暴走防止）。
 *
 * agent-runner は apps/api(HTTP) の薄いラッパであり、ドメインや DB を直接持たない。
 * ここで保持するのは「どの口座を・どのエージェントとして・どの頻度で回すか」と
 * 暴走防止の上限のみ。実際のリスクガード（金額/集中度/現金）は api 側の RiskGuard が
 * AgentProfile.riskLimits に基づき強制するため、ここでは二重防御として 1 ループあたりの
 * 発注上限と enabled / 頻度のみを持つ。
 *
 * LLM キー等の秘密情報は DecisionProvider 実装に env をそのまま渡して露出を最小化し、
 * この設定オブジェクトには載せない（apps/api / ingestion-worker と同方針）。
 */
export interface RunnerConfig {
  /** Redis 接続 URL（BullMQ）。 */
  redisUrl: string;
  /** 叩く apps/api のベース URL（末尾スラッシュ無し）。 */
  apiBaseUrl: string;
  /** api 呼び出しのタイムアウト（ms）。 */
  requestTimeoutMs: number;

  /** 自律ループを有効にするか。既定 false（明示的に有効化させる。§9 暴走防止）。 */
  enabled: boolean;
  /** スケジュール対象の口座 ID（AGENT 口座）。 */
  accountId: string;
  /** 発注主体のエージェントプロファイル ID（AgentDecision の監査証跡に必須）。 */
  agentProfileId: string;
  /** 判断に用いる LLM モデル名（DecisionProvider が参照。HOLD プロバイダでは未使用）。 */
  model: string;
  /** DecisionProvider の種別。"hold"=無 LLM の安全既定、"llm"=実 LLM 呼び出し（課金）。 */
  provider: "hold" | "llm";
  /** 自律ループの実行 cron（既定: 平日 0:00 UTC 1 回/日。頻度・課金を控えめに）。 */
  cron: string;
  /** 1 ループあたりの最大発注（ORDER/CANCEL）数。超過分は捨てる（§9 暴走防止）。 */
  maxActionsPerLoop: number;
  /** BullMQ の繰り返し登録を行うか（false なら consumer のみ。手動 enqueue 用）。 */
  scheduleEnabled: boolean;
}

const parseIntOr = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const parseBool = (raw: string | undefined, fallback: boolean): boolean => {
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
};

const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

const parseProvider = (raw: string | undefined): "hold" | "llm" =>
  raw?.trim().toLowerCase() === "llm" ? "llm" : "hold";

/** プロセス環境（または注入された env）から自律ループ設定を構築する。 */
export const loadRunnerConfig = (
  env: Record<string, string | undefined> = process.env,
): RunnerConfig => {
  const base =
    env.AGENT_RUNNER_API_BASE_URL?.trim() ||
    `http://localhost:${env.API_PORT?.trim() || "3001"}`;
  return {
    redisUrl: env.REDIS_URL?.trim() || "redis://localhost:6379",
    apiBaseUrl: trimTrailingSlash(base),
    requestTimeoutMs: parseIntOr(env.AGENT_RUNNER_REQUEST_TIMEOUT_MS, 15000),

    // 既定 disabled: 明示的にオプトインさせる（LLM 課金 + 自動執行のため。§8/§9）。
    enabled: parseBool(env.AGENT_RUNNER_ENABLED, false),
    accountId: env.AGENT_RUNNER_ACCOUNT_ID?.trim() || "",
    agentProfileId: env.AGENT_RUNNER_PROFILE_ID?.trim() || "",
    model: env.AGENT_LLM_MODEL?.trim() || "claude-opus-4-8",
    provider: parseProvider(env.AGENT_RUNNER_PROVIDER),
    // 既定は 1 日 1 回（頻度・課金を控えめに。§2.7 コスト注記）。
    cron: env.AGENT_RUNNER_CRON?.trim() || "0 0 * * *",
    maxActionsPerLoop: parseIntOr(env.AGENT_RUNNER_MAX_ACTIONS, 3),
    scheduleEnabled: parseBool(env.AGENT_RUNNER_SCHEDULE_ENABLED, true),
  };
};
