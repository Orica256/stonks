import type { FetchFn } from "./http.js";

/**
 * テスト用 fetch モック。実ネットワークを使わずアダプタを検証するための DI 部品
 * （CLAUDE.md §3: 実ネットワーク依存テストを書かない）。
 */
export interface MockResponseSpec {
  status?: number;
  json?: unknown;
  text?: string;
  /** 呼び出し時に投げる（ネットワーク障害の模擬）。 */
  throws?: unknown;
}

export interface MockFetch {
  fn: FetchFn;
  calls: string[];
}

/** URL → 応答のマッチャ列で fetch をモックする。最初にマッチした規則を使う。 */
export const mockFetch = (
  routes: Array<{ match: (url: string) => boolean; respond: MockResponseSpec }>,
): MockFetch => {
  const calls: string[] = [];
  const fn: FetchFn = async (url) => {
    calls.push(url);
    const route = routes.find((r) => r.match(url));
    if (!route) {
      throw new Error(`mockFetch: no route for ${url}`);
    }
    const spec = route.respond;
    if (spec.throws !== undefined) throw spec.throws;
    const status = spec.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => spec.json,
      text: async () => spec.text ?? JSON.stringify(spec.json ?? null),
    };
  };
  return { fn, calls };
};

/** 単一応答を返す簡易モック。 */
export const singleFetch = (spec: MockResponseSpec): MockFetch =>
  mockFetch([{ match: () => true, respond: spec }]);
