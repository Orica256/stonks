import { DomainError } from "@stonks/contracts";

/**
 * HTTP 取得関数の最小シグネチャ（Node 標準 fetch 互換）。
 * テストではこれをモックに差し替えることで実ネットワークなしに検証する（CLAUDE.md §3）。
 */
export type FetchFn = (
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
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** 既定では Node 24 のグローバル fetch を使う。HTTP ライブラリ依存は追加しない。 */
export const defaultFetch: FetchFn = (input, init) =>
  fetch(input, init) as unknown as ReturnType<FetchFn>;

export interface HttpOptions {
  headers?: Record<string, string>;
  /** タイムアウト（ms）。無料 API の不安定さに備える（spec §9）。 */
  timeoutMs?: number;
}

/**
 * JSON GET ヘルパ。レート超過(429)と一般障害を DomainError に正規化する。
 * 外部 API のステータス差異をここで吸収し、上位はフォールバック判定に集中できる。
 */
export const getJson = async (
  fetchFn: FetchFn,
  url: string,
  source: string,
  opts: HttpOptions = {},
): Promise<unknown> => {
  const controller = new AbortController();
  const timeout =
    opts.timeoutMs && opts.timeoutMs > 0
      ? setTimeout(() => controller.abort(), opts.timeoutMs)
      : undefined;
  try {
    const res = await fetchFn(url, {
      method: "GET",
      ...(opts.headers ? { headers: opts.headers } : {}),
      signal: controller.signal,
    });
    if (res.status === 429) {
      throw new DomainError("RATE_LIMITED", `${source}: rate limited (429)`);
    }
    if (!res.ok) {
      throw new DomainError(
        "PROVIDER_UNAVAILABLE",
        `${source}: HTTP ${res.status}`,
      );
    }
    return await res.json();
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(
      "PROVIDER_UNAVAILABLE",
      `${source}: request failed`,
      e,
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};
