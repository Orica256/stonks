import { describe, expect, it } from "vitest";
import {
  applyClick,
  createIdGenerator,
  describeDrawing,
  orderByTime,
  priceAtTime,
  removeDrawing,
  toLinePoint,
  type TrendlineDrawing,
} from "./drawing";

describe("applyClick", () => {
  const id = (): string => "X";

  it("horizontal モードは即座に水平線を確定する", () => {
    const res = applyClick(
      "horizontal",
      { time: 100, price: 42 },
      undefined,
      id,
    );
    expect(res.added).toEqual({ id: "X", kind: "horizontal", price: 42 });
    expect(res.pending).toBeUndefined();
  });

  it("trendline 1 点目は pending に保持し確定しない", () => {
    const res = applyClick(
      "trendline",
      { time: 100, price: 10 },
      undefined,
      id,
    );
    expect(res.added).toBeUndefined();
    expect(res.pending).toEqual({
      kind: "trendline",
      a: { time: 100, price: 10 },
    });
  });

  it("trendline 2 点目で線分を確定し pending を解消する", () => {
    const res = applyClick(
      "trendline",
      { time: 200, price: 20 },
      { kind: "trendline", a: { time: 100, price: 10 } },
      id,
    );
    expect(res.added).toEqual({
      id: "X",
      kind: "trendline",
      a: { time: 100, price: 10 },
      b: { time: 200, price: 20 },
    });
    expect(res.pending).toBeUndefined();
  });

  it("trendline 端点は time 昇順に正規化される（後→前のクリックでも）", () => {
    const res = applyClick(
      "trendline",
      { time: 50, price: 5 },
      { kind: "trendline", a: { time: 100, price: 10 } },
      id,
    );
    const line = res.added as TrendlineDrawing;
    expect(line.a).toEqual({ time: 50, price: 5 });
    expect(line.b).toEqual({ time: 100, price: 10 });
  });

  it("none モードは何もしない", () => {
    const res = applyClick("none", { time: 1, price: 1 }, undefined, id);
    expect(res.added).toBeUndefined();
    expect(res.pending).toBeUndefined();
  });
});

describe("orderByTime", () => {
  it("time 昇順に並べる", () => {
    const [a, b] = orderByTime(
      { time: 200, price: 2 },
      { time: 100, price: 1 },
    );
    expect(a.time).toBe(100);
    expect(b.time).toBe(200);
  });

  it("同時刻は入力順を保つ", () => {
    const [a, b] = orderByTime(
      { time: 100, price: 1 },
      { time: 100, price: 2 },
    );
    expect(a.price).toBe(1);
    expect(b.price).toBe(2);
  });
});

describe("priceAtTime", () => {
  const line: TrendlineDrawing = {
    id: "t",
    kind: "trendline",
    a: { time: 0, price: 100 },
    b: { time: 10, price: 200 },
  };

  it("端点では端点価格を返す", () => {
    expect(priceAtTime(line, 0)).toBe(100);
    expect(priceAtTime(line, 10)).toBe(200);
  });

  it("中点は線形補間する", () => {
    expect(priceAtTime(line, 5)).toBe(150);
  });

  it("範囲外は直線を延長する", () => {
    expect(priceAtTime(line, 20)).toBe(300);
    expect(priceAtTime(line, -10)).toBe(0);
  });

  it("端点が同時刻なら a.price を返す（ゼロ除算回避）", () => {
    const vertical: TrendlineDrawing = {
      id: "v",
      kind: "trendline",
      a: { time: 5, price: 50 },
      b: { time: 5, price: 80 },
    };
    expect(priceAtTime(vertical, 5)).toBe(50);
  });
});

describe("removeDrawing", () => {
  it("id 一致を除去し新配列を返す", () => {
    const drawings = [
      { id: "a", kind: "horizontal" as const, price: 1 },
      { id: "b", kind: "horizontal" as const, price: 2 },
    ];
    const next = removeDrawing(drawings, "a");
    expect(next).toEqual([{ id: "b", kind: "horizontal", price: 2 }]);
    expect(next).not.toBe(drawings);
  });
});

describe("toLinePoint", () => {
  it("有限な time/price から点を作る", () => {
    expect(toLinePoint(100, 42)).toEqual({ time: 100, price: 42 });
  });

  it("欠落・非有限は undefined", () => {
    expect(toLinePoint(undefined, 42)).toBeUndefined();
    expect(toLinePoint(100, undefined)).toBeUndefined();
    expect(toLinePoint(NaN, 42)).toBeUndefined();
    expect(toLinePoint(100, Infinity)).toBeUndefined();
  });
});

describe("createIdGenerator", () => {
  it("呼ぶたび一意の連番を返す", () => {
    const next = createIdGenerator("d");
    expect(next()).toBe("d1");
    expect(next()).toBe("d2");
    expect(next()).toBe("d3");
  });
});

describe("describeDrawing", () => {
  it("水平線のラベル", () => {
    expect(describeDrawing({ id: "h", kind: "horizontal", price: 12.5 })).toBe(
      "水平線 @ 12.5",
    );
  });

  it("トレンドラインのラベル", () => {
    expect(
      describeDrawing({
        id: "t",
        kind: "trendline",
        a: { time: 1, price: 10 },
        b: { time: 2, price: 20 },
      }),
    ).toBe("トレンドライン 10 → 20");
  });
});
