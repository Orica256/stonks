"use client";

import { useState } from "react";
import type { CorporateAction, Instrument } from "@stonks/contracts";
import {
  useApplyCorporateAction,
  useCorporateActions,
} from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatTimestamp } from "@/lib/format";

/** コーポレートアクション種別の表示ラベル（DIVIDEND/SPLIT）。 */
function actionTypeLabel(type: CorporateAction["type"]): string {
  return type === "DIVIDEND" ? "配当" : "分割";
}

/**
 * 銘柄の配当・分割イベント一覧（spec §2.3 / GET /instruments/:id/corporate-actions）。
 *
 * 一覧から各イベントを口座へ反映できる（POST /accounts/:id/corporate-actions）。
 * 反映はシミュレーション上の処理（配当→現金/台帳、分割→ポジション調整は api 側）。
 * 投資助言ではない（CLAUDE.md §7）。
 */
export function CorporateActionsPanel({
  accountId,
  instrument,
}: {
  accountId: string;
  instrument: Instrument | null;
}): JSX.Element {
  const query = useCorporateActions(instrument?.id);
  const mutation = useApplyCorporateAction(accountId);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);

  function keyOf(a: CorporateAction): string {
    return `${a.instrumentId}|${a.type}|${a.exDate}`;
  }

  function handleApply(action: CorporateAction): void {
    setAppliedKey(null);
    mutation.mutate(action, {
      onSuccess: () => setAppliedKey(keyOf(action)),
    });
  }

  const applyError =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? "口座への反映に失敗しました。"
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          配当・分割
          {instrument ? ` · ${instrument.symbol}` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!instrument ? (
          <EmptyState>銘柄を選択すると配当・分割を表示します。</EmptyState>
        ) : query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message="配当・分割データの取得に失敗しました。" />
        ) : !query.data || query.data.length === 0 ? (
          <EmptyState>対象期間の配当・分割はありません。</EmptyState>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="py-2 pr-4">種別</th>
                    <th className="py-2 pr-4">権利落ち日</th>
                    <th className="py-2 pr-4 text-right">値</th>
                    <th className="py-2 pr-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.map((a) => {
                    const k = keyOf(a);
                    return (
                      <tr key={k} className="border-t border-neutral-100">
                        <td className="py-2 pr-4 font-medium">
                          {actionTypeLabel(a.type)}
                        </td>
                        <td className="py-2 pr-4">{formatTimestamp(a.exDate)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {a.value}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {appliedKey === k ? (
                            <span className="text-xs text-gain">反映済み</span>
                          ) : (
                            <Button
                              variant="secondary"
                              onClick={() => handleApply(a)}
                              disabled={mutation.isPending}
                            >
                              口座に反映
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {applyError && <ErrorState message={applyError} />}
            <p className="text-xs text-neutral-500">
              「口座に反映」はシミュレーション上の処理です（配当は現金へ、分割は保有数量へ反映）。
              実際の金銭移動は行いません。投資助言ではありません。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
