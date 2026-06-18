import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter (token bucket)", () => {
  it("allows up to maxInInterval immediately, then blocks", () => {
    const t = 0;
    const rl = new RateLimiter({
      intervalMs: 1000,
      maxInInterval: 3,
      now: () => t,
    });
    expect(rl.tryTake()).toBe(true);
    expect(rl.tryTake()).toBe(true);
    expect(rl.tryTake()).toBe(true);
    expect(rl.tryTake()).toBe(false); // バケット枯渇
  });

  it("refills tokens as virtual time advances", () => {
    let t = 0;
    const rl = new RateLimiter({
      intervalMs: 1000,
      maxInInterval: 2,
      now: () => t,
    });
    expect(rl.tryTake()).toBe(true);
    expect(rl.tryTake()).toBe(true);
    expect(rl.tryTake()).toBe(false);
    t = 600; // 0.6s → 2 tokens/s で ~1.2 トークン補充
    expect(rl.tryTake()).toBe(true);
    expect(rl.tryTake()).toBe(false);
  });

  it("take() waits (via injected sleep) until a token is available", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const rl = new RateLimiter({
      intervalMs: 1000,
      maxInInterval: 1,
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms; // sleep が仮想時計を進める
      },
    });
    await rl.take(); // 即時
    await rl.take(); // 待機が発生するはず
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps[0]).toBeGreaterThan(0);
  });
});
