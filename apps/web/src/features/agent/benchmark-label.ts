import type { BenchmarkUnavailableReason } from "@stonks/contracts";

/**
 * ベンチ比較が成立しない理由（contracts の `BenchmarkUnavailableReason`）を
 * 日本語の説明ラベルに変換する（spec §2.7 P1）。
 *
 * 推測リターンを出さず「なぜ比較できないか」を明示するための表示専用ヘルパ。
 * 投資助言ではない（CLAUDE.md §7）。
 */
export function benchmarkUnavailableLabel(
  reason: BenchmarkUnavailableReason,
): string {
  switch (reason) {
    case "NOT_CONFIGURED":
      return "ベンチマーク銘柄が未設定です";
    case "PRICE_DATA_MISSING":
      return "ベンチマークの価格データが不足しています";
    case "NO_STRATEGY_EQUITY":
      return "比較に必要な戦略の資産推移データが不足しています";
  }
}
