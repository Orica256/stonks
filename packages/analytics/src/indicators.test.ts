import { describe, expect, it } from "vitest";
import { bbands, ema, macd, rsi, sma } from "./indicators.js";

describe("sma", () => {
  it("computes simple moving average with null warmup prefix", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("period 1 echoes the input", () => {
    expect(sma([10, 20, 30], 1)).toEqual([10, 20, 30]);
  });

  it("returns all null when input shorter than period", () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });

  it("rejects non-positive period", () => {
    expect(() => sma([1, 2, 3], 0)).toThrow();
  });
});

describe("ema", () => {
  it("seeds with SMA then applies smoothing factor", () => {
    // period 3 -> k = 0.5, seed = SMA(first 3) = 2 at index 2.
    // idx3 = 4*0.5 + 2*0.5 = 3 ; idx4 = 5*0.5 + 3*0.5 = 4.
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("returns all null when input shorter than period", () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });
});

describe("rsi (Wilder)", () => {
  it("computes known small-series values", () => {
    // period 2, input [1,2,3,2]: out[2] = 100 (no losses), out[3] = 50.
    expect(rsi([1, 2, 3, 2], 2)).toEqual([null, null, 100, 50]);
  });

  it("is 100 for a strictly rising series (no losses)", () => {
    const out = rsi([1, 2, 3, 4, 5, 6], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull();
    expect(out[3]).toBe(100);
    expect(out[5]).toBe(100);
  });

  it("returns all null when input length <= period", () => {
    expect(rsi([1, 2, 3], 3)).toEqual([null, null, null]);
  });
});

describe("macd", () => {
  it("macd line is EMA(fast) - EMA(slow); histogram = macd - signal", () => {
    const input = Array.from({ length: 40 }, (_, i) => i + 1);
    const fast = 3;
    const slow = 6;
    const signal = 4;
    const r = macd(input, fast, slow, signal);
    const ef = ema(input, fast);
    const es = ema(input, slow);

    expect(r.macd).toHaveLength(input.length);
    expect(r.signal).toHaveLength(input.length);
    expect(r.histogram).toHaveLength(input.length);

    // macd null until slow EMA is defined (index slow-1 = 5).
    expect(r.macd[slow - 2]).toBeNull();
    for (let i = slow - 1; i < input.length; i++) {
      expect(r.macd[i]).toBeCloseTo(es[i]! != null ? ef[i]! - es[i]! : NaN, 10);
    }

    // histogram = macd - signal wherever both defined.
    for (let i = 0; i < input.length; i++) {
      const m = r.macd[i];
      const s = r.signal[i];
      const h = r.histogram[i];
      if (m != null && s != null) {
        expect(h).toBeCloseTo(m - s, 10);
      } else {
        expect(h).toBeNull();
      }
    }
  });

  it("rejects fast >= slow", () => {
    expect(() => macd([1, 2, 3], 6, 3, 2)).toThrow();
  });
});

describe("bbands", () => {
  it("middle is SMA; bands are mean +/- stdDev * population sigma", () => {
    const r = bbands([2, 4, 6], 3, 2);
    expect(r.middle).toEqual([null, null, 4]);
    const sigma = Math.sqrt(8 / 3);
    expect(r.upper[2]).toBeCloseTo(4 + 2 * sigma, 10);
    expect(r.lower[2]).toBeCloseTo(4 - 2 * sigma, 10);
    expect(r.upper[0]).toBeNull();
    expect(r.lower[1]).toBeNull();
  });

  it("zero variance gives bands equal to the mean", () => {
    const r = bbands([5, 5, 5, 5], 3, 2);
    expect(r.middle[3]).toBe(5);
    expect(r.upper[3]).toBe(5);
    expect(r.lower[3]).toBe(5);
  });
});
