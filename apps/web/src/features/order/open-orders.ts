import type { Order, OrderStatus } from "@stonks/contracts";

/**
 * オープン注文一覧（open-orders-panel.tsx）の純粋ロジック（Phase 6）。
 *
 * UI から分離し Vitest 対象にする。オープン判定・グルーピング・ソートを担い、
 * 投資助言は含まない（CLAUDE.md §7）。価格演算は行わず表示は UI/format に委ねる。
 */

/** オープン（未確定で取消可能）とみなす status。約定/取消/失効/却下は除く。 */
const OPEN_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "PENDING",
  "PARTIALLY_FILLED",
]);

/**
 * 注文がオープン（一覧表示対象）かを判定する。
 * - status が PENDING / PARTIALLY_FILLED のもの、または
 * - activation==="WAITING"（親約定待ちの休眠注文。status が PENDING 想定だが念のため）
 * を「オープン」とみなす。CANCELLED/FILLED/REJECTED/EXPIRED は除外する。
 */
export function isOpenOrder(order: Order): boolean {
  if (order.activation === "WAITING") {
    // 待機中でも取消/却下/失効済みは除外する。
    return order.status !== "CANCELLED" &&
      order.status !== "REJECTED" &&
      order.status !== "EXPIRED" &&
      order.status !== "FILLED";
  }
  return OPEN_STATUSES.has(order.status);
}

/** 注文配列からオープンのみを抽出する。 */
export function filterOpenOrders(orders: readonly Order[]): Order[] {
  return orders.filter(isOpenOrder);
}

/**
 * 1 グループ（複合注文の束、または単発 1 件）の表示単位。
 * - `linkGroupId` を持つ注文は同一グループにまとめる。
 * - それ以外（親子のみ／単発）は parentOrderId の親キーか自身の id をキーにする。
 */
export interface OrderGroup {
  /** グルーピングキー（linkGroupId 優先、無ければ親 id / 自身 id）。 */
  key: string;
  /** グループの linkType（束ねた注文のうち最初に見つかったもの）。 */
  linkType: Order["linkType"];
  /** 一括取消に使う linkGroupId（無ければ undefined＝単発取消のみ）。 */
  linkGroupId: string | undefined;
  /** グループに属する注文（親→子→作成日時降順で整列済み）。 */
  orders: Order[];
}

/**
 * 注文のグルーピングキーを決める。
 * - `linkGroupId` 優先（OCO/bracket 子は同一束）。
 * - 無ければ親子で束ねる: 子は親 id、親は自身 id を「親キー」とする
 *   （IFD 親と子が同一グループに入るようにする）。
 */
function groupKeyOf(order: Order): string {
  if (order.linkGroupId) return `g:${order.linkGroupId}`;
  // 子は親 id、親（または単発）は自身 id を親キーにする。
  return `p:${order.parentOrderId ?? order.id}`;
}

/** createdAt 降順（新しい順）。同時刻は id で安定化する。 */
function byCreatedDesc(a: Order, b: Order): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 親（parentOrderId を持たない）を先頭に、子を後ろに並べる。 */
function byParentChild(a: Order, b: Order): number {
  const aChild = a.parentOrderId ? 1 : 0;
  const bChild = b.parentOrderId ? 1 : 0;
  if (aChild !== bChild) return aChild - bChild;
  return byCreatedDesc(a, b);
}

/**
 * オープン注文を複合関係（OCO/IFD/bracket）でグルーピングする。
 * 各グループ内は親→子→新しい順に整列し、グループ自体は代表注文の新しい順で並べる。
 */
export function groupOpenOrders(orders: readonly Order[]): OrderGroup[] {
  const open = filterOpenOrders(orders);
  const buckets = new Map<string, Order[]>();

  for (const order of open) {
    const key = groupKeyOf(order);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(order);
    else buckets.set(key, [order]);
  }

  const groups: OrderGroup[] = [];
  for (const [key, bucket] of buckets) {
    const sorted = [...bucket].sort(byParentChild);
    const linkGroupId = sorted.find((o) => o.linkGroupId)?.linkGroupId;
    const linkType = sorted.find((o) => o.linkType)?.linkType;
    groups.push({ key, linkType, linkGroupId, orders: sorted });
  }

  // グループは代表注文（先頭＝親）の新しい順に並べる。
  groups.sort((a, b) => byCreatedDesc(a.orders[0]!, b.orders[0]!));
  return groups;
}

/** 注文 status の日本語ラベル。 */
export function orderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case "PENDING":
      return "未約定";
    case "PARTIALLY_FILLED":
      return "一部約定";
    case "FILLED":
      return "約定済";
    case "CANCELLED":
      return "取消済";
    case "REJECTED":
      return "却下";
    case "EXPIRED":
      return "失効";
    default:
      return status;
  }
}
