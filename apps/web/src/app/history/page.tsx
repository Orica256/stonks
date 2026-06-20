"use client";

import { useTrades } from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import {
  errorMessage,
  formatPrice,
  formatQuantity,
  formatTimestamp,
} from "@/lib/format";
import { DEFAULT_ACCOUNT_ID } from "@/lib/env";

/**
 * 取引履歴画面（spec §2.3）。約定（Trade）の一覧を新しい順に表示する。
 */
export default function HistoryPage(): JSX.Element {
  const trades = useTrades(DEFAULT_ACCOUNT_ID);

  return (
    <Card>
      <CardHeader>
        <CardTitle>取引履歴</CardTitle>
      </CardHeader>
      <CardContent>
        {trades.isLoading ? (
          <LoadingState />
        ) : trades.isError ? (
          <ErrorState message={errorMessage(trades.error)} />
        ) : !trades.data || trades.data.length === 0 ? (
          <EmptyState>約定はまだありません。</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-2 pr-4">約定日時</th>
                  <th className="py-2 pr-4">銘柄</th>
                  <th className="py-2 pr-4">売買</th>
                  <th className="py-2 pr-4 text-right">数量</th>
                  <th className="py-2 pr-4 text-right">約定単価</th>
                  <th className="py-2 pr-4 text-right">手数料</th>
                </tr>
              </thead>
              <tbody>
                {[...trades.data]
                  .sort((a, b) => b.executedAt.localeCompare(a.executedAt))
                  .map((t) => (
                    <tr key={t.id} className="border-t border-neutral-100">
                      <td className="py-2 pr-4 text-neutral-500">
                        {formatTimestamp(t.executedAt)}
                      </td>
                      <td className="py-2 pr-4 font-medium">{t.instrumentId}</td>
                      <td
                        className={`py-2 pr-4 font-medium ${
                          t.side === "BUY" ? "text-gain" : "text-loss"
                        }`}
                      >
                        {t.side === "BUY" ? "買い" : "売り"}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {formatQuantity(t.quantity)}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {formatPrice(t.price, t.currency)}
                      </td>
                      <td className="py-2 pr-4 text-right text-neutral-500">
                        {formatPrice(t.fee, t.currency)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
