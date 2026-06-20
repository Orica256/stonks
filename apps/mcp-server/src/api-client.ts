/**
 * apps/api(HTTP) を叩く薄いクライアント。
 *
 * mcp-server はドメイン（trading-engine / portfolio / agent-trader 等）を直接
 * import せず、REST 経由でのみ結合する（spec §4.3「mcp-server → contracts ＋
 * API(HTTP) のみ」）。fetch は注入可能にし、テストはフェイクに対して行う
 * （実 api・実ネットワークに依存しない。CLAUDE.md §3）。
 */

/** fetch と同形の最小シグネチャ（テスト時のフェイク差し替え点）。 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface ApiClientOptions {
  baseUrl: string;
  fetch: FetchLike;
  /** リクエストタイムアウト（ms）。未指定なら無制限。 */
  timeoutMs?: number;
}

/** API がエラー応答（非 2xx）を返したことを表す。tool 層で握って整形する。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(`API ${method} ${path} failed (${status}): ${body}`);
    this.name = "ApiError";
  }
}

type QueryValue = string | number | undefined;

const buildQuery = (query?: Record<string, QueryValue>): string => {
  if (!query) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
};

/**
 * apps/api への JSON クライアント。各メソッドは生の JSON を返し、契約スキーマでの
 * 検証は呼び出し側（tools）が contracts の Zod 型で行う（手書き型を作らない）。
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number | undefined;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchFn = opts.fetch;
    this.timeoutMs = opts.timeoutMs;
  }

  /** GET。path は先頭スラッシュ付きの相対パス（例 "/instruments"）。 */
  get(path: string, query?: Record<string, QueryValue>): Promise<unknown> {
    return this.request("GET", `${path}${buildQuery(query)}`);
  }

  /** POST（JSON 本文）。 */
  post(path: string, body: unknown): Promise<unknown> {
    return this.request("POST", path, body);
  }

  /** DELETE。 */
  delete(path: string): Promise<unknown> {
    return this.request("DELETE", path);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const controller =
      this.timeoutMs !== undefined ? new AbortController() : undefined;
    const timer =
      controller !== undefined
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : undefined;
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(controller !== undefined ? { signal: controller.signal } : {}),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new ApiError(res.status, method, path, text);
      }
      return text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
