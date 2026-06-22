"use client";

import { useDecisions, usePerformance } from "@/lib/api/hooks";
import { benchmarkUnavailableLabel } from "@/features/agent/benchmark-label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import {
  errorMessage,
  formatPercent,
  formatSigned,
  formatTimestamp,
  pnlColorClass,
} from "@/lib/format";
import { DEFAULT_ACCOUNT_ID } from "@/lib/env";

/**
 * AI エージェント画面（spec §2.7）。成績スナップショット・ベンチ比較と、
 * 全発注の意思決定ログ（監査証跡）を可視化する。投資助言ではない（CLAUDE.md §7）。
 */
export default function AgentPage(): JSX.Element {
  const accountId = DEFAULT_ACCOUNT_ID;
  const performance = usePerformance(accountId, "1m");
  const decisions = useDecisions(accountId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>成績（直近1ヶ月）</CardTitle>
        </CardHeader>
        <CardContent>
          {performance.isLoading ? (
            <LoadingState />
          ) : performance.isError ? (
            <ErrorState message={errorMessage(performance.error)} />
          ) : !performance.data ? (
            <EmptyState>成績データがありません。</EmptyState>
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat
                  label="累積リターン"
                  value={formatPercent(performance.data.snapshot.cumulativeReturn)}
                  colorClass={pnlColorClass(
                    performance.data.snapshot.cumulativeReturn,
                  )}
                />
                <Stat
                  label="最大DD"
                  value={formatPercent(performance.data.snapshot.maxDrawdown)}
                />
                <Stat
                  label="シャープ"
                  value={formatSigned(performance.data.snapshot.sharpe)}
                />
                <Stat
                  label="勝率"
                  value={formatPercent(performance.data.snapshot.winRate)}
                />
              </dl>
              {performance.data.comparisonResult.available ? (
                <p className="text-sm text-neutral-600">
                  ベンチ（
                  {performance.data.comparisonResult.comparison.benchmark}）比
                  超過リターン:{" "}
                  <span
                    className={pnlColorClass(
                      performance.data.comparisonResult.comparison.excessReturn,
                    )}
                  >
                    {formatPercent(
                      performance.data.comparisonResult.comparison.excessReturn,
                    )}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-neutral-400">
                  ベンチ（{performance.data.comparisonResult.benchmark}）比較は
                  表示できません:{" "}
                  {benchmarkUnavailableLabel(
                    performance.data.comparisonResult.reason,
                  )}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>意思決定ログ（監査証跡）</CardTitle>
        </CardHeader>
        <CardContent>
          {decisions.isLoading ? (
            <LoadingState />
          ) : decisions.isError ? (
            <ErrorState message={errorMessage(decisions.error)} />
          ) : !decisions.data || decisions.data.length === 0 ? (
            <EmptyState>意思決定ログはまだありません。</EmptyState>
          ) : (
            <ul className="space-y-3">
              {[...decisions.data]
                .sort((a, b) => b.ts.localeCompare(a.ts))
                .map((d) => (
                  <li
                    key={d.id}
                    className="rounded-md border border-neutral-200 p-3 text-sm"
                  >
                    <div className="flex items-center justify-between text-xs text-neutral-500">
                      <span>{formatTimestamp(d.ts)}</span>
                      <span>{d.model}</span>
                    </div>
                    <p className="mt-1 text-neutral-800">{d.rationale}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      発注 {d.resultOrderIds.length} 件 · アクション{" "}
                      {d.proposedActions.length} 件
                    </p>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass?: string;
}): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className={`text-lg font-semibold ${colorClass ?? "text-neutral-900"}`}>
        {value}
      </dd>
    </div>
  );
}
