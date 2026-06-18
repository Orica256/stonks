/**
 * トークンバケット方式のレート制御（spec §3.1: Finnhub 60 req/min 等）。
 * 無料枠を尊重するため、各アダプタは外部呼び出し前に `take()` を待つ。
 * 時刻関数は DI 可能（テストで仮想時計を注入し、実時間 sleep を避ける）。
 */
export interface RateLimiterOptions {
  /** 補充の基準となる時間窓（ms）。 */
  intervalMs: number;
  /** intervalMs あたりに許可する最大トークン数。 */
  maxInInterval: number;
  /** 現在時刻（ms）。既定は Date.now。 */
  now?: () => number;
  /** 待機関数。既定は setTimeout ベース。テストでは即時解決に差し替える。 */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private tokens: number;
  private last: number;

  constructor(opts: RateLimiterOptions) {
    this.capacity = opts.maxInInterval;
    this.refillPerMs = opts.maxInInterval / opts.intervalMs;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
    this.tokens = opts.maxInInterval;
    this.last = this.now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.last;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.last = t;
  }

  /** トークンが得られるまで待ってから 1 つ消費する。 */
  async take(): Promise<void> {
    this.refill();
    while (this.tokens < 1) {
      const deficit = 1 - this.tokens;
      const waitMs = Math.ceil(deficit / this.refillPerMs);
      await this.sleep(waitMs);
      this.refill();
    }
    this.tokens -= 1;
  }

  /** 待たずに 1 つ取得を試みる。取れたら true。 */
  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
