import type { Quote } from "@stonks/contracts";
import { API_BASE_URL } from "@/lib/env";

/**
 * GET /quotes/stream?ids= の SSE を購読する（spec §6.8）。
 * 無料制約により真のリアルタイム配信ではなく短間隔ポーリング配信を購読する。
 *
 * @returns 購読解除関数。
 */
export function subscribeQuotes(
  instrumentIds: string[],
  onQuote: (quote: Quote) => void,
  onError?: (err: Event) => void,
): () => void {
  if (instrumentIds.length === 0) return () => {};

  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`;
  const url = new URL("quotes/stream", base);
  url.searchParams.set("ids", instrumentIds.join(","));

  const source = new EventSource(url.toString());

  const handler = (ev: MessageEvent<string>): void => {
    try {
      onQuote(JSON.parse(ev.data) as Quote);
    } catch {
      // 壊れたイベントは無視（縮退）。
    }
  };

  source.addEventListener("quote", handler as EventListener);
  if (onError) source.addEventListener("error", onError);

  return () => {
    source.removeEventListener("quote", handler as EventListener);
    source.close();
  };
}
