import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "./cache.js";

describe("TtlCache", () => {
  it("returns cached value within TTL and expires after", () => {
    let t = 0;
    const cache = new TtlCache<number>(100, () => t);
    cache.set("k", 42);
    expect(cache.get("k")).toBe(42);
    t = 99;
    expect(cache.get("k")).toBe(42);
    t = 100;
    expect(cache.get("k")).toBeUndefined(); // 期限切れ
  });

  it("wrap() calls loader only once within TTL", async () => {
    let t = 0;
    const cache = new TtlCache<string>(1000, () => t);
    const loader = vi.fn().mockResolvedValue("v");
    expect(await cache.wrap("k", loader)).toBe("v");
    expect(await cache.wrap("k", loader)).toBe("v");
    expect(loader).toHaveBeenCalledTimes(1); // 2 回目はキャッシュ

    t = 2000;
    expect(await cache.wrap("k", loader)).toBe("v");
    expect(loader).toHaveBeenCalledTimes(2); // 期限切れ後は再ロード
  });
});
