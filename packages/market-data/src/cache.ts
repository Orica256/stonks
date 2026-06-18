/**
 * 単純な TTL インメモリキャッシュ。無料枠の節約と遅延吸収のため
 * 気配/為替など短命データを一定時間再利用する（spec §3.1, §9）。
 * 時刻は DI 可能（テストで仮想時計を注入）。
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (this.now() >= hit.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /** キャッシュヒットを返すか、未ヒットなら loader を呼び結果を格納して返す。 */
  async wrap(key: string, loader: () => Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await loader();
    this.set(key, value);
    return value;
  }

  clear(): void {
    this.store.clear();
  }
}
