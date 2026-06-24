import type { MarginType } from "@stonks/contracts";
import { cn } from "@/lib/cn";
import { marginBadgeClassName, marginTypeLabel } from "@/lib/margin-display";

/**
 * 資金区分（現物 CASH / 信用 MARGIN）の小さなバッジ（Phase 8.1）。
 *
 * 保有ポジション・取引履歴・オープン注文の一覧で区分を一目で分かるよう露出する。
 * 未指定（undefined）は現物（CASH）として表示する（`marginType ?? "CASH"`）。
 * className は既存の取引所/status バッジと同じ流儀（角丸・極小フォント・トーン別 bg/text）。
 * 投資判断を促す表現は置かない（事実のみ。CLAUDE.md §7）。
 */
export function MarginBadge({
  marginType,
}: {
  /** 契約の optional な区分。未指定は現物（CASH）。 */
  marginType: MarginType | undefined;
}): JSX.Element {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
        marginBadgeClassName(marginType),
      )}
    >
      {marginTypeLabel(marginType)}
    </span>
  );
}
