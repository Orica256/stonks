"use client";

import type { Instrument } from "@stonks/contracts";
import { useBars } from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { useAnalysisStore } from "./analysis-store";
import { changeFromBars, heatColorClass, heatLevel } from "./lib/heatmap";

/**
 * ヒートマップパネル（spec §2.4 P2）。
 * 選択中の各銘柄の直近バー比騰落率をタイル色で表示する。
 * データは既存 GET /instruments/:id/bars の再利用のみ（新規エンドポイントなし）。
 */
export function HeatmapPanel(): JSX.Element {
  const instruments = useAnalysisStore((s) => s.instruments);

  return (
    <Card>
      <CardHeader>
        <CardTitle>騰落率ヒートマップ（直近バー比）</CardTitle>
      </CardHeader>
      <CardContent>
        {instruments.length === 0 ? (
          <EmptyState>左で銘柄を追加すると騰落率をタイル表示します。</EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {instruments.map((inst) => (
                <HeatTile key={inst.id} instrument={inst} />
              ))}
            </div>
            <p className="mt-3 text-xs text-neutral-400">
              色は直近バーの相対変化を示す表示です。投資判断の根拠ではありません。
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** 1 銘柄ぶんのタイル。フックを銘柄ごとの子に閉じる（ループ呼びを避ける）。 */
function HeatTile({ instrument }: { instrument: Instrument }): JSX.Element {
  const query = useBars(instrument.id, "1d");
  const change = query.data ? changeFromBars(query.data) : undefined;
  const level = heatLevel(change);

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md px-3 py-4 transition-colors",
        heatColorClass(level),
      )}
    >
      <span className="text-sm font-semibold">{instrument.symbol}</span>
      <span className="text-xs tabular-nums opacity-90">
        {query.isLoading
          ? "…"
          : change === undefined
            ? "—"
            : formatPercent(change)}
      </span>
    </div>
  );
}
