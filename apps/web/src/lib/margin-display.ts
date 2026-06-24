import type { MarginType } from "@stonks/contracts";

/**
 * 資金区分（現物 CASH / 信用 MARGIN）の表示ヘルパ（Phase 8.1）。
 *
 * 契約の `Position.marginType` / `Trade.marginType` / `Order.marginType` は optional で、
 * 未指定は CASH（現物）を意味する（packages/contracts margin.ts / portfolio.ts）。
 * 一覧（保有・取引履歴・注文）で区分を一目で分かるようにするための純粋ヘルパ。
 *
 * 表示は事実のみ（投資助言表現は置かない。CLAUDE.md §7）。バッジの className は
 * 既存の取引所/activation/status バッジの流儀（角丸・極小フォント・トーン別の bg/text）に合わせる。
 */

/** 未指定（undefined）を CASH に正規化した実効区分。 */
export function effectiveMarginType(
  marginType: MarginType | undefined,
): MarginType {
  return marginType ?? "CASH";
}

/** 資金区分の日本語ラベル（CASH→現物 / MARGIN→信用）。未指定は現物。 */
export function marginTypeLabel(marginType: MarginType | undefined): string {
  return effectiveMarginType(marginType) === "MARGIN" ? "信用" : "現物";
}

/**
 * バッジのトーン別 className（既存バッジの bg/text トーンに揃える）。
 * - 現物（CASH）  : 既定の muted トーン（周囲から浮かない控えめな灰）。
 * - 信用（MARGIN）: status トーン寄りの濃いめの灰で区別する。
 */
export function marginBadgeClassName(
  marginType: MarginType | undefined,
): string {
  return effectiveMarginType(marginType) === "MARGIN"
    ? "bg-neutral-200 text-neutral-700"
    : "bg-neutral-100 text-neutral-500";
}
