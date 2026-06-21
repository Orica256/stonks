"use client";

import dynamic from "next/dynamic";
import type { BacktestResult } from "@stonks/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { toEquityChart, toMetricViews } from "./lib/equity";

// lightweight-charts はブラウザ専用（canvas）。SSR を無効化する。
const EquityChart = dynamic(
  () => import("./equity-chart").then((m) => m.EquityChart),
  { ssr: false, loading: () => <LoadingState label="チャートを準備中…" /> },
);

/**
 * バックテスト結果（指標サマリ + エクイティカーブ）の表示（spec §2.5）。
 * 数値は contracts の BacktestResult を整形して見せるだけで、投資判断を促す表現は入れない。
 */
export function BacktestResultView({
  result,
}: {
  result: BacktestResult;
}): JSX.Element {
  const metrics = toMetricViews(result.metrics);
  const points = toEquityChart(result.equityCurve);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>成績指標</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {metrics.map((m) => (
              <div key={m.label} className="space-y-1">
                <dt className="text-xs text-neutral-500">{m.label}</dt>
                <dd
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    toneClass(m.tone),
                  )}
                >
                  {m.display}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>エクイティカーブ（口座評価額の推移）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {points.length === 0 ? (
            <EmptyState>
              エクイティカーブを描画できるデータがありません。期間や戦略を見直してください。
            </EmptyState>
          ) : (
            <EquityChart points={points} />
          )}
          <p className="text-xs text-neutral-400">
            過去データに対するシミュレーション結果であり、将来の成果を示すものでも投資助言でもありません。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** 指標トーン（正=上げ色 / 負=下げ色 / 0・null=中立）に応じた色クラス。 */
function toneClass(tone: number | null): string {
  if (tone === null || tone === 0) return "text-neutral-800";
  return tone > 0 ? "text-gain" : "text-loss";
}
