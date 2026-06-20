/**
 * 免責表示（CLAUDE.md §7 / spec §9）。
 * 本アプリは投資助言ではなくシミュレーション。投資判断を促す表現は置かない。
 */
export function Disclaimer(): JSX.Element {
  return (
    <p className="border-t border-neutral-200 bg-neutral-100 px-4 py-2 text-center text-xs text-neutral-500">
      本アプリは仮想資金によるペーパートレードのシミュレーションです。投資助言・推奨ではなく、実際の発注や金銭の入出金は行いません。表示価格は遅延・不正確な場合があります。
    </p>
  );
}
