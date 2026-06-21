import { describe, expect, it } from "vitest";
import { StrategyDef } from "@stonks/contracts";
import { STRATEGY_PRESETS, findPreset } from "./strategy";

describe("STRATEGY_PRESETS", () => {
  it("各プリセットが contracts の StrategyDef を満たす定義を生成する", () => {
    for (const preset of STRATEGY_PRESETS) {
      const def = preset.build({
        universe: ["TSE:7203"],
        timeframe: "1d",
      });
      // 契約スキーマでバリデーション（手書き型に逃げず契約を真実とする）。
      expect(() => StrategyDef.parse(def)).not.toThrow();
      expect(def.universe).toEqual(["TSE:7203"]);
      expect(def.timeframe).toBe("1d");
      expect(def.rules.length).toBeGreaterThan(0);
    }
  });

  it("選択した時間足を StrategyDef に反映する", () => {
    const def = findPreset("sma-cross")!.build({
      universe: ["NASDAQ:AAPL"],
      timeframe: "1h",
    });
    expect(def.timeframe).toBe("1h");
    expect(def.universe).toEqual(["NASDAQ:AAPL"]);
  });

  it("プリセットの when 式はサポート構文のみを使う", () => {
    const supported =
      /^(always|sma\(\d+\)\s+(crossup|crossdown)\s+sma\(\d+\)|price\s*(>=|<=|>|<)\s*-?\d+(\.\d+)?)$/i;
    for (const preset of STRATEGY_PRESETS) {
      const def = preset.build({ universe: ["TSE:7203"], timeframe: "1d" });
      for (const rule of def.rules) {
        expect(rule.when.trim()).toMatch(supported);
      }
    }
  });
});

describe("findPreset", () => {
  it("既知の id を引ける", () => {
    expect(findPreset("buy-and-hold")?.id).toBe("buy-and-hold");
  });

  it("未知の id は undefined", () => {
    expect(findPreset("nope")).toBeUndefined();
  });
});
