import type { Money, PriceProvider } from "@stonks/contracts";
import { Money as MoneyUtil } from "@stonks/core-domain";

/**
 * 仮想時間で前進するヒストリカル PriceProvider（spec §6.5）。
 *
 * `getLatestPrice(id, at)` は「at 時点までに観測済みの最新 close」のみを返す。
 * 未来バーは参照しない（ルックアヘッド禁止）。`advanceTo` で現在時刻を進める。
 */
export class HistoricalPriceFeed implements PriceProvider {
  private now = new Date(0);
  /** instrumentId -> [ts(ms) 昇順, close] */
  private readonly series: Map<string, { ts: number; close: string }[]>;
  private readonly currency: Map<string, "JPY" | "USD">;

  constructor(
    series: Record<
      string,
      { points: { ts: number; close: string }[]; currency: "JPY" | "USD" }
    >,
  ) {
    this.series = new Map();
    this.currency = new Map();
    for (const [id, v] of Object.entries(series)) {
      this.series.set(
        id,
        [...v.points].sort((a, b) => a.ts - b.ts),
      );
      this.currency.set(id, v.currency);
    }
  }

  /** 仮想時間を進める。 */
  advanceTo(now: Date): void {
    this.now = now;
  }

  async getLatestPrice(instrumentId: string, at?: Date): Promise<Money> {
    const cutoff = (at ?? this.now).getTime();
    const points = this.series.get(instrumentId) ?? [];
    let close: string | undefined;
    // ts <= cutoff の最後の点（昇順なので前方走査で最後を採用）。
    for (const p of points) {
      if (p.ts <= cutoff) close = p.close;
      else break;
    }
    const currency = this.currency.get(instrumentId) ?? "JPY";
    if (close === undefined) {
      // まだ観測点なし。価格不明として 0 を返す（呼び出し側で発注しない前提）。
      return MoneyUtil.zero(currency);
    }
    return MoneyUtil.money(close, currency);
  }
}
