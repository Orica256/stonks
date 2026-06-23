"use client";

import { useMemo, type ReactNode } from "react";
import type { Order } from "@stonks/contracts";
import { useCancelOrder, useCancelOrderGroup, useOrders } from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { formatQuantity, formatTimestamp } from "@/lib/format";
import {
  activationLabel,
  linkTypeLabel,
} from "./bracket";
import {
  groupOpenOrders,
  orderStatusLabel,
  type OrderGroup,
} from "./open-orders";

/**
 * オープン注文一覧（spec §2.2 / Phase 6。GET /accounts/:id/orders）。
 *
 * 口座の未約定・待機中の注文を常時可視化し、複合注文（OCO / IFD / bracket）の
 * 関係（WAITING/ACTIVE・linkGroup・親子）を表示する。単発取消（DELETE /orders/:id）と
 * グループ取消（DELETE /orders/groups/:linkGroupId）を提供する。
 *
 * API が `?open=true` 未対応でも壊れないよう、全件取得→web 側でオープンに絞る。
 * 投資判断を促す表現は置かない（CLAUDE.md §7）。
 */
export function OpenOrdersPanel({
  accountId,
}: {
  accountId: string;
}): JSX.Element {
  const query = useOrders(accountId);
  const cancelOrder = useCancelOrder(accountId);
  const cancelGroup = useCancelOrderGroup(accountId);

  const groups = useMemo(
    () => (query.data ? groupOpenOrders(query.data) : []),
    [query.data],
  );

  const cancelError =
    cancelOrder.error instanceof ApiError
      ? cancelOrder.error.message
      : cancelOrder.error
        ? "注文の取消に失敗しました。"
        : cancelGroup.error instanceof ApiError
          ? cancelGroup.error.message
          : cancelGroup.error
            ? "グループ取消に失敗しました。"
            : null;

  const cancelPending = cancelOrder.isPending || cancelGroup.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>オープン注文</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message="注文一覧の取得に失敗しました。" />
        ) : groups.length === 0 ? (
          <EmptyState>未約定・待機中の注文はありません。</EmptyState>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-3">
              {groups.map((group) => (
                <OrderGroupCard
                  key={group.key}
                  group={group}
                  onCancelOrder={(id) => cancelOrder.mutate(id)}
                  onCancelGroup={(gid) => cancelGroup.mutate(gid)}
                  cancelPending={cancelPending}
                />
              ))}
            </ul>
            {cancelError && <ErrorState message={cancelError} />}
            <p className="text-xs text-neutral-500">
              シミュレーション上の注文状況です。投資助言ではありません。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** 1 グループ（複合注文の束、または単発 1 件）の表示。 */
function OrderGroupCard({
  group,
  onCancelOrder,
  onCancelGroup,
  cancelPending,
}: {
  group: OrderGroup;
  onCancelOrder: (orderId: string) => void;
  onCancelGroup: (linkGroupId: string) => void;
  cancelPending: boolean;
}): JSX.Element {
  const isLinked = Boolean(group.linkGroupId) || group.orders.length > 1;

  return (
    <li className="rounded-md border border-neutral-200 p-3">
      {isLinked && group.linkType && (
        <div className="mb-2 flex items-center gap-1.5">
          <Badge tone="link">{linkTypeLabel(group.linkType)}</Badge>
          <span className="text-xs text-neutral-500">
            複合注文（{group.orders.length} 件）
          </span>
        </div>
      )}

      <ul className="space-y-1.5">
        {group.orders.map((order) => (
          <OrderRow
            key={order.id}
            order={order}
            onCancel={() => onCancelOrder(order.id)}
            cancelPending={cancelPending}
          />
        ))}
      </ul>

      {group.linkGroupId && (
        <div className="pt-2">
          <Button
            type="button"
            variant="danger"
            disabled={cancelPending}
            onClick={() => onCancelGroup(group.linkGroupId as string)}
          >
            {cancelPending ? "取消中…" : "グループを一括取消"}
          </Button>
        </div>
      )}
    </li>
  );
}

/** 1 注文の行表示（銘柄/売買/種別/数量/価格/有効期限/各種バッジ＋単発取消）。 */
function OrderRow({
  order,
  onCancel,
  cancelPending,
}: {
  order: Order;
  onCancel: () => void;
  cancelPending: boolean;
}): JSX.Element {
  const isChild = Boolean(order.parentOrderId);
  // 注文は通貨情報を持たないため、価格は DecimalString をそのまま表示する
  // （通貨換算/桁整形は銘柄文脈が要るため、ここでは加工しない）。
  const limit = order.limitPrice ? `指 ${order.limitPrice}` : null;
  const stop = order.stopPrice ? `逆 ${order.stopPrice}` : null;
  const price = [limit, stop].filter(Boolean).join(" / ") || "成行";

  return (
    <li
      className={cn(
        "rounded-md bg-neutral-50 px-2 py-1.5 text-xs",
        isChild && "ml-4 border-l-2 border-neutral-200 pl-2",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-neutral-700">
          {order.instrumentId}
        </span>
        <span
          className={cn(
            "font-medium",
            order.side === "BUY" ? "text-gain" : "text-loss",
          )}
        >
          {order.side === "BUY" ? "買い" : "売り"}
        </span>
        <span className="text-neutral-700">{order.type}</span>
        <span className="tabular-nums text-neutral-700">
          {formatQuantity(order.filledQuantity)}/
          {formatQuantity(order.quantity)}
        </span>
        <span className="tabular-nums text-neutral-700">{price}</span>
        <span className="text-neutral-500">{order.timeInForce}</span>
        <Badge tone="status">{orderStatusLabel(order.status)}</Badge>
        <Badge tone={order.activation === "WAITING" ? "muted" : "active"}>
          {activationLabel(order.activation)}
        </Badge>
        {isChild && <Badge tone="muted">子</Badge>}
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[10px] text-neutral-400">
          {formatTimestamp(order.createdAt)}
        </span>
        <Button
          type="button"
          variant="ghost"
          disabled={cancelPending}
          onClick={onCancel}
        >
          取消
        </Button>
      </div>
    </li>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "active" | "muted" | "link" | "status";
  children: ReactNode;
}): JSX.Element {
  const cls =
    tone === "active"
      ? "bg-gain/10 text-gain"
      : tone === "link"
        ? "bg-neutral-900 text-white"
        : tone === "status"
          ? "bg-neutral-200 text-neutral-700"
          : "bg-neutral-100 text-neutral-500";
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
        cls,
      )}
    >
      {children}
    </span>
  );
}
