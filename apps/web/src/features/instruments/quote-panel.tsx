"use client";

import type { Instrument } from "@stonks/contracts";
import { useQuote } from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatPrice, formatTimestamp } from "@/lib/format";

/** 選択銘柄の最新気配（spec §6.8 GET /instruments/:id/quote）。 */
export function QuotePanel({
  instrument,
}: {
  instrument: Instrument | null;
}): JSX.Element {
  const query = useQuote(instrument?.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>気配</CardTitle>
      </CardHeader>
      <CardContent>
        {!instrument ? (
          <EmptyState>銘柄を選択してください。</EmptyState>
        ) : query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message="気配の取得に失敗しました。" />
        ) : !query.data ? (
          <EmptyState>気配がありません。</EmptyState>
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-neutral-500">
                {instrument.symbol} · {instrument.name}
              </span>
            </div>
            <div className="text-3xl font-semibold tabular-nums text-neutral-900">
              {formatPrice(query.data.last, instrument.currency)}
              <span className="ml-2 text-sm font-normal text-neutral-400">
                {instrument.currency}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <QuoteField
                label="買気配 (bid)"
                value={
                  query.data.bid
                    ? formatPrice(query.data.bid, instrument.currency)
                    : "—"
                }
              />
              <QuoteField
                label="売気配 (ask)"
                value={
                  query.data.ask
                    ? formatPrice(query.data.ask, instrument.currency)
                    : "—"
                }
              />
            </dl>
            <p className="text-xs text-neutral-400">
              出典: {query.data.source} · {formatTimestamp(query.data.ts)}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuoteField({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="rounded-md bg-neutral-50 px-3 py-2">
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className="tabular-nums font-medium text-neutral-800">{value}</dd>
    </div>
  );
}
