import { describe, expect, it } from "vitest";
import type { BenchmarkUnavailableReason } from "@stonks/contracts";
import { benchmarkUnavailableLabel } from "./benchmark-label";

/**
 * ベンチ比較不能理由の日本語ラベル化（spec §2.7 P1）。
 * 推測リターンを出さず、理由ごとに固定文言を返すことを保証する。
 */
describe("benchmarkUnavailableLabel", () => {
  it.each<[BenchmarkUnavailableReason, string]>([
    ["NOT_CONFIGURED", "ベンチマーク銘柄が未設定です"],
    ["PRICE_DATA_MISSING", "ベンチマークの価格データが不足しています"],
    ["NO_STRATEGY_EQUITY", "比較に必要な戦略の資産推移データが不足しています"],
  ])("reason=%s を日本語ラベルへ変換する", (reason, label) => {
    expect(benchmarkUnavailableLabel(reason)).toBe(label);
  });
});
