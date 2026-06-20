import { API_BASE_URL } from "@/lib/env";

/**
 * apps/api（spec §6.8）を叩く薄い HTTP クライアント。
 *
 * web は contracts の型のみを使い、ドメインパッケージを import しない（spec §4.3）。
 * レスポンス型は呼び出し側がジェネリクスで contracts 型を指定する。ここでは
 * トランスポートとエラー正規化のみを担う。
 */

/** apps/api の DomainExceptionFilter が返すエラー本文の形（apps/api/common）。 */
export interface ApiErrorBody {
  error: { code?: string; message?: string };
}

/** HTTP/ドメインエラーを UI で扱いやすい形に正規化した例外。 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string | number | undefined> | undefined;
  body?: unknown;
  signal?: AbortSignal | undefined;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(
    path.startsWith("/") ? path.slice(1) : path,
    API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`,
  );
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function toApiError(res: Response): Promise<ApiError> {
  let code: string | undefined;
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    if (body && typeof body === "object" && body.error) {
      code = body.error.code;
      if (body.error.message) message = body.error.message;
    }
  } catch {
    // JSON でない（プレーンテキスト等）場合はステータス文言のままにする。
  }
  return new ApiError(res.status, code, message);
}

/** 任意のレスポンス型 T を返す汎用リクエスト。型は contracts から指定する。 */
export async function apiRequest<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { method = "GET", query, body, signal } = opts;
  const init: RequestInit = { method, cache: "no-store" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  if (signal !== undefined) {
    init.signal = signal;
  }
  const res = await fetch(buildUrl(path, query), init);

  if (!res.ok) {
    throw await toApiError(res);
  }

  // 204 / 空ボディは undefined を返す。
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (text.length === 0) return undefined as T;
  return JSON.parse(text) as T;
}
