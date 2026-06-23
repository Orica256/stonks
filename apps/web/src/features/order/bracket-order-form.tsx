"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import type {
  Instrument,
  Order,
  OrderType,
  TimeInForce,
} from "@stonks/contracts";
import {
  useCancelOrderGroup,
  usePlaceBracketOrder,
} from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { formatPrice, formatQuantity } from "@/lib/format";
import {
  activationLabel,
  buildBracketCommand,
  emptyLeg,
  linkTypeLabel,
  needsLimit,
  needsStop,
  type BracketFormState,
  type BracketKind,
  type LegInput,
} from "./bracket";

/**
 * 複合注文（OCO / IFD / BRACKET）入力（spec §2.2 P2 / Phase 5。POST /accounts/:id/orders/bracket）。
 *
 * 価格は浮動小数で送らず DecimalString（文字列）のまま送る（CLAUDE.md §0）。
 * accountId はパス側で注入されるため body には含めない。
 * 投資判断を促す表現は置かない（CLAUDE.md §7）。
 */
export function BracketOrderForm({
  accountId,
  instrument,
}: {
  accountId: string;
  instrument: Instrument | null;
}): JSX.Element {
  const [kind, setKind] = useState<BracketKind>("OCO");
  const [legs, setLegs] = useState<LegInput[]>(() => initialLegs("OCO"));
  const [timeInForce, setTimeInForce] = useState<TimeInForce>("DAY");
  const [localError, setLocalError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Order[] | null>(null);

  const mutation = usePlaceBracketOrder(accountId);
  const cancelGroup = useCancelOrderGroup(accountId);

  function changeKind(next: BracketKind): void {
    setKind(next);
    setLegs(initialLegs(next));
    setPlaced(null);
    setLocalError(null);
  }

  function updateLeg(index: number, patch: Partial<LegInput>): void {
    setLegs((prev) =>
      prev.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)),
    );
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    setLocalError(null);
    setPlaced(null);

    if (!instrument) return;

    const state: BracketFormState = { kind, legs };
    const result = buildBracketCommand(state, instrument.id, timeInForce);
    if (!result.ok) {
      setLocalError(result.error);
      return;
    }

    mutation.mutate(result.command, {
      onSuccess: (orders) => {
        setPlaced(orders);
      },
    });
  }

  const submitError =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? "複合注文の発注に失敗しました。"
        : null;

  const labels = legLabels(kind, legs.length);

  return (
    <Card>
      <CardHeader>
        <CardTitle>複合注文（OCO / IFD / BRACKET）</CardTitle>
      </CardHeader>
      <CardContent>
        {!instrument ? (
          <EmptyState>銘柄を選択すると複合注文を発注できます。</EmptyState>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="text-sm text-neutral-500">
              {instrument.symbol} · {instrument.name}（{instrument.currency}）
            </div>

            <div className="grid grid-cols-3 gap-2">
              <KindButton
                active={kind === "OCO"}
                label="OCO"
                onClick={() => changeKind("OCO")}
              />
              <KindButton
                active={kind === "IFD"}
                label="IFD"
                onClick={() => changeKind("IFD")}
              />
              <KindButton
                active={kind === "BRACKET"}
                label="BRACKET"
                onClick={() => changeKind("BRACKET")}
              />
            </div>

            <p className="text-xs text-neutral-400">{kindHint(kind)}</p>

            <div className="space-y-3">
              {legs.map((leg, i) => (
                <LegEditor
                  key={i}
                  label={labels[i] ?? `脚 ${i + 1}`}
                  leg={leg}
                  lotSize={instrument.lotSize}
                  onChange={(patch) => updateLeg(i, patch)}
                />
              ))}
            </div>

            {kind === "IFD" && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setLegs((prev) => [...prev, emptyLeg("SELL")])}
                >
                  子注文を追加
                </Button>
                {legs.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setLegs((prev) => prev.slice(0, -1))}
                  >
                    末尾の子を削除
                  </Button>
                )}
              </div>
            )}

            <label className="block text-sm">
              <span className="text-neutral-500">有効期限</span>
              <select
                value={timeInForce}
                onChange={(e) =>
                  setTimeInForce(e.target.value as TimeInForce)
                }
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              >
                <option value="DAY">当日 (DAY)</option>
                <option value="GTC">無期限 (GTC)</option>
              </select>
            </label>

            {localError && <ErrorState message={localError} />}
            {submitError && <ErrorState message={submitError} />}

            <Button
              type="submit"
              variant="primary"
              disabled={mutation.isPending}
              className="w-full"
            >
              {mutation.isPending ? "送信中…" : `${kind} 注文を出す`}
            </Button>

            {placed && placed.length > 0 && (
              <PlacedGroup
                orders={placed}
                currency={instrument.currency}
                onCancelGroup={(groupId) => cancelGroup.mutate(groupId)}
                cancelPending={cancelGroup.isPending}
                cancelError={
                  cancelGroup.error instanceof ApiError
                    ? cancelGroup.error.message
                    : cancelGroup.error
                      ? "グループ取消に失敗しました。"
                      : null
                }
              />
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** kind ごとの初期脚（OCO/BRACKET=固定数、IFD=親 1＋子 1）。 */
function initialLegs(kind: BracketKind): LegInput[] {
  if (kind === "OCO") return [emptyLeg("SELL"), emptyLeg("SELL")];
  if (kind === "BRACKET") {
    // 親 ＋ 利確（LIMIT）＋ 損切（STOP）。
    return [emptyLeg("BUY"), emptyLeg("SELL"), emptyLeg("SELL")];
  }
  // IFD: 親 ＋ 子 1。
  return [emptyLeg("BUY"), emptyLeg("SELL")];
}

/** 脚ごとの表示ラベル。 */
function legLabels(kind: BracketKind, count: number): string[] {
  if (kind === "OCO") return ["脚 1", "脚 2"];
  if (kind === "BRACKET") return ["親注文", "子注文（利確）", "子注文（損切）"];
  // IFD
  const out = ["親注文"];
  for (let i = 1; i < count; i += 1) out.push(`子注文 ${i}`);
  return out;
}

function kindHint(kind: BracketKind): string {
  if (kind === "OCO") {
    return "2 脚を同時に有効化し、片方が約定するともう片方を自動取消します。";
  }
  if (kind === "IFD") {
    return "親注文が約定すると、待機中の子注文が有効化されます。";
  }
  return "親約定で利確・損切の子 2 本が有効化され、子同士は OCO で連動します。";
}

function KindButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600",
      )}
    >
      {label}
    </button>
  );
}

function LegEditor({
  label,
  leg,
  lotSize,
  onChange,
}: {
  label: string;
  leg: LegInput;
  lotSize: number;
  onChange: (patch: Partial<LegInput>) => void;
}): JSX.Element {
  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <div className="mb-2 text-xs font-semibold text-neutral-700">{label}</div>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <SideButton
          active={leg.side === "BUY"}
          activeClass="bg-gain text-white"
          label="買い"
          onClick={() => onChange({ side: "BUY" })}
        />
        <SideButton
          active={leg.side === "SELL"}
          activeClass="bg-loss text-white"
          label="売り"
          onClick={() => onChange({ side: "SELL" })}
        />
      </div>

      <label className="mb-2 block text-sm">
        <span className="text-neutral-500">注文種別</span>
        <select
          value={leg.type}
          onChange={(e) => onChange({ type: e.target.value as OrderType })}
          className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="MARKET">成行 (MARKET)</option>
          <option value="LIMIT">指値 (LIMIT)</option>
          <option value="STOP">逆指値 (STOP)</option>
          <option value="STOP_LIMIT">逆指値リミット (STOP_LIMIT)</option>
        </select>
      </label>

      <label className="mb-2 block text-sm">
        <span className="text-neutral-500">数量</span>
        <input
          inputMode="numeric"
          value={leg.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          placeholder={`${lotSize} 株単位`}
          className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm tabular-nums"
        />
      </label>

      {needsLimit(leg.type) && (
        <label className="mb-2 block text-sm">
          <span className="text-neutral-500">指値価格</span>
          <input
            inputMode="decimal"
            value={leg.limitPrice}
            onChange={(e) => onChange({ limitPrice: e.target.value })}
            placeholder="例: 1234.5"
            className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
      )}
      {needsStop(leg.type) && (
        <label className="block text-sm">
          <span className="text-neutral-500">逆指値価格</span>
          <input
            inputMode="decimal"
            value={leg.stopPrice}
            onChange={(e) => onChange({ stopPrice: e.target.value })}
            placeholder="例: 1234.5"
            className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
      )}
    </div>
  );
}

function SideButton({
  active,
  activeClass,
  label,
  onClick,
}: {
  active: boolean;
  activeClass: string;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? activeClass : "bg-neutral-100 text-neutral-600",
      )}
    >
      {label}
    </button>
  );
}

/**
 * 発注された複合注文グループの可視化（リンク関係・発効状態）。
 * 親約定待ちの子は「待機」、それ以外は「有効」をバッジ表示する（Phase 5）。
 */
function PlacedGroup({
  orders,
  currency,
  onCancelGroup,
  cancelPending,
  cancelError,
}: {
  orders: Order[];
  currency: Instrument["currency"];
  onCancelGroup: (linkGroupId: string) => void;
  cancelPending: boolean;
  cancelError: string | null;
}): JSX.Element {
  // 親（parentOrderId を持たない）を先頭に、子を後ろに並べる。
  const sorted = useMemo(() => {
    return [...orders].sort((a, b) => {
      const aParent = a.parentOrderId ? 1 : 0;
      const bParent = b.parentOrderId ? 1 : 0;
      return aParent - bParent;
    });
  }, [orders]);

  // 取消対象のグループ ID（最初に見つかった linkGroupId）。OCO/bracket 子が持つ。
  const groupId = useMemo(
    () => orders.find((o) => o.linkGroupId)?.linkGroupId,
    [orders],
  );

  return (
    <div className="space-y-2 rounded-md border border-gain/30 bg-gain/5 p-3">
      <p className="text-sm font-medium text-gain">
        複合注文を受け付けました（{orders.length} 件）。
      </p>
      <ul className="space-y-1.5">
        {sorted.map((o) => (
          <OrderRow key={o.id} order={o} currency={currency} />
        ))}
      </ul>

      {groupId && (
        <div className="pt-1">
          <Button
            type="button"
            variant="danger"
            disabled={cancelPending}
            onClick={() => onCancelGroup(groupId)}
          >
            {cancelPending ? "取消中…" : "グループを一括取消"}
          </Button>
          {cancelError && <ErrorState className="mt-2" message={cancelError} />}
        </div>
      )}
    </div>
  );
}

/** 1 注文の行表示（種別・発効状態・親子・リンクグループのバッジ付き）。 */
function OrderRow({
  order,
  currency,
}: {
  order: Order;
  currency: Instrument["currency"];
}): JSX.Element {
  const isChild = Boolean(order.parentOrderId);
  const rawPrice = order.limitPrice ?? order.stopPrice;
  const price = rawPrice ? formatPrice(rawPrice, currency) : "—";

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-md bg-white px-2 py-1.5 text-xs",
        isChild && "ml-4 border-l-2 border-neutral-200 pl-2",
      )}
    >
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
        {formatQuantity(order.quantity)} @ {price}
      </span>
      <Badge tone={order.activation === "WAITING" ? "muted" : "active"}>
        {activationLabel(order.activation)}
      </Badge>
      {order.linkType && (
        <Badge tone="link">{linkTypeLabel(order.linkType)}</Badge>
      )}
      {isChild && <Badge tone="muted">子</Badge>}
    </li>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "active" | "muted" | "link";
  children: ReactNode;
}): JSX.Element {
  const cls =
    tone === "active"
      ? "bg-gain/10 text-gain"
      : tone === "link"
        ? "bg-neutral-900 text-white"
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
