"use client";

import { usePositions, useSummary } from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states";
import {
  errorMessage,
  formatMoneyValue,
  formatPrice,
  formatQuantity,
  formatPercent,
  pnlColorClass,
} from "@/lib/format";
import { DEFAULT_ACCOUNT_ID } from "@/lib/env";

/**
 * ポートフォリオ画面（spec §2.3）。保有ポジション（評価額・含み損益）と総資産サマリ。
 */
export default function PortfolioPage(): JSX.Element {
  const accountId = DEFAULT_ACCOUNT_ID;
  const positions = usePositions(accountId);
  const summary = useSummary(accountId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>サマリ</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.isLoading ? (
            <LoadingState />
          ) : summary.isError ? (
            <ErrorState message={errorMessage(summary.error)} />
          ) : summary.data ? (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="総資産" value={formatMoneyValue(summary.data.equity)} />
              <Stat label="現金" value={formatMoneyValue(summary.data.cash)} />
              <Stat
                label="評価額"
                value={formatMoneyValue(summary.data.positionsValue)}
              />
              <Stat
                label="含み損益"
                value={formatMoneyValue(summary.data.unrealizedPnl)}
                colorClass={pnlColorClass(Number(summary.data.unrealizedPnl.amount))}
              />
              <Stat
                label="実現損益"
                value={formatMoneyValue(summary.data.realizedPnl)}
                colorClass={pnlColorClass(Number(summary.data.realizedPnl.amount))}
              />
            </dl>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>保有ポジション</CardTitle>
        </CardHeader>
        <CardContent>
          {positions.isLoading ? (
            <LoadingState />
          ) : positions.isError ? (
            <ErrorState message={errorMessage(positions.error)} />
          ) : !positions.data || positions.data.length === 0 ? (
            <EmptyState>保有ポジションはありません。</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="py-2 pr-4">銘柄</th>
                    <th className="py-2 pr-4 text-right">数量</th>
                    <th className="py-2 pr-4 text-right">平均取得</th>
                    <th className="py-2 pr-4 text-right">現在値</th>
                    <th className="py-2 pr-4 text-right">評価額</th>
                    <th className="py-2 pr-4 text-right">含み損益</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.data.map((p) => (
                    <tr key={p.id} className="border-t border-neutral-100">
                      <td className="py-2 pr-4 font-medium">{p.instrumentId}</td>
                      <td className="py-2 pr-4 text-right">
                        {formatQuantity(p.quantity)}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {formatPrice(p.avgCost, p.currency)}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {formatPrice(p.marketPrice, p.currency)}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {formatMoneyValue(p.marketValue)}
                      </td>
                      <td
                        className={`py-2 pr-4 text-right ${pnlColorClass(
                          Number(p.unrealizedPnl.amount),
                        )}`}
                      >
                        {formatMoneyValue(p.unrealizedPnl)} (
                        {formatPercent(p.unrealizedPnlPct)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
