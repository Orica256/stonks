import { z } from "zod";
import { Id, Timestamp } from "./common.js";

/**
 * 複合注文（OCO / IFD）の契約（spec §2.2 P2「OCO/IFD などの複合注文」。Phase 5）。
 *
 * 既存の単発 `Order` を壊さず、複数注文を 1 グループに束ねて表現する最小モデル。
 * `Order` に optional の link フィールド（`linkGroupId` / `linkType` / `parentOrderId` /
 * `activation`）を足すだけで、リンクの無い従来注文は完全に従来挙動を保つ（後方互換）。
 *
 * 約定/取消のカスケード（片約定で他方取消、親約定で子発効）は trading-engine の責務。
 * ここでは型・意味論・不変条件だけを契約として固定する。
 */

/**
 * 複合注文のリンク種別。
 * - `OCO` (One-Cancels-Other): 同一 `linkGroupId` の 2 注文を 1 グループに束ね、
 *   片方が約定（FILLED または最初の部分約定）したらもう片方を自動 CANCELLED にする。
 *   どちらも発注直後から `activation === "ACTIVE"`（同時にオープン。先に条件を満たした方が
 *   約定し、他方は取消される）。
 * - `IFD` (If-Done): `parentOrderId` を持つ子注文が、親注文の約定で発効（activate）する。
 *   子は発注時 `activation === "WAITING"` で、エンジンの評価対象から外れる（休眠）。
 *   親が約定したらエンジンが子を `activation === "ACTIVE"` に遷移させ、以後通常注文として扱う。
 *
 * IFD-OCO（親約定後に子 2 本を OCO で建てる "bracket"）は、子 2 本に同一 `linkGroupId`＋
 * `linkType === "OCO"` と共通の `parentOrderId`＋`linkType` の併用ではなく、本 enum の
 * 1 値では表せない。bracket は `PlaceBracketOrderCommand`（後述）で発注し、エンジンが
 * 「親=IFD・子同士=OCO」の関係を `parentOrderId`（IFD）と `linkGroupId`（OCO）の
 * 併用で表現する（`linkType` は子に "OCO" を、親に "IFD" を設定）。
 */
export const OrderLinkType = z.enum(["OCO", "IFD"]);
export type OrderLinkType = z.infer<typeof OrderLinkType>;

/**
 * 注文の発効状態（複合注文用。Phase 5）。
 * - `ACTIVE`  : 通常どおりエンジンの約定評価対象（既定。単発/OCO/発効済み IFD 子）。
 * - `WAITING` : 親の約定待ちで休眠中（IFD 子の初期状態）。エンジンは評価から除外する。
 *
 * `OrderStatus` とは直交する軸（`status` は PENDING のまま `activation` だけ WAITING に
 * できる）。`OrderStatus` enum に値を足すと既存の OPEN_STATUSES 判定・永続層を揺らすため、
 * 発効状態は別フィールドとして導入し、未指定（=単発の従来注文）は ACTIVE とみなす。
 */
export const OrderActivation = z.enum(["ACTIVE", "WAITING"]);
export type OrderActivation = z.infer<typeof OrderActivation>;

/**
 * 複合注文グループ（spec §5.1 への追加候補。Phase 5）。
 *
 * OCO/IFD/bracket のメタ情報を 1 行で持つ任意のグルーピング記録。`Order` 側の
 * optional link フィールドだけでもカスケードは成立するため、本型は「グループ単位の
 * 取消・状態照会・監査」を行いたい消費側（api/web）向けの読み取り表現として提供する。
 * 永続化は任意（後続 Wave が必要と判断したらテーブル化。現時点では DB 追加なし）。
 */
export const OrderGroup = z.object({
  id: Id,
  accountId: Id,
  linkType: OrderLinkType,
  /** グループに属する注文 ID（OCO は 2 件、IFD は親 1＋子 1 以上、bracket は親 1＋子 2）。 */
  orderIds: z.array(Id).min(2),
  /** IFD/bracket の親注文 ID（OCO は親無しのため undefined）。 */
  parentOrderId: Id.optional(),
  createdAt: Timestamp,
});
export type OrderGroup = z.infer<typeof OrderGroup>;

/**
 * 複合発注コマンド（OCO / IFD / bracket）。Phase 5。
 *
 * 既存 `PlaceOrderCommand`（単発）の superRefine を壊さないため、複合は **別コマンド**として
 * 新設する。各 leg/親/子は `PlaceOrderCommand`（の入力形）であり、trading-engine が
 * `PlaceOrderCommand` スキーマで個別に検証してから link を張る。型循環回避のため leg の
 * 中身は `z.unknown()` とし、ランタイム検証はエンジンの placeBracketOrder 実装が
 * `PlaceOrderCommand.safeParse` で行う（contracts は構造と意味論を固定）。
 *
 * - `kind: "OCO"`    : `legs`(2 本) を同時に ACTIVE で置く。片約定で他方取消。
 * - `kind: "IFD"`    : `parent` 約定で `children`(1 本以上) を WAITING→ACTIVE に発効。
 * - `kind: "BRACKET"`: `parent` 約定で `children`(2 本) を発効し、子同士を OCO で結ぶ
 *   （利確＋損切の同時設置。親約定→子 2 本発効→片約定で他方取消）。
 */
export const PlaceBracketOrderCommand = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("OCO"),
    /** 同時に ACTIVE で置く 2 脚（PlaceOrderCommand 入力形。エンジンが個別検証）。 */
    legs: z.tuple([z.unknown(), z.unknown()]),
  }),
  z.object({
    kind: z.literal("IFD"),
    /** 親注文（PlaceOrderCommand 入力形）。約定で子を発効させる。 */
    parent: z.unknown(),
    /** 親約定で WAITING→ACTIVE になる子注文（1 本以上）。 */
    children: z.array(z.unknown()).min(1),
  }),
  z.object({
    kind: z.literal("BRACKET"),
    /** 親注文（PlaceOrderCommand 入力形）。 */
    parent: z.unknown(),
    /** 親約定で発効し、子同士を OCO で結ぶ 2 脚（利確＋損切）。 */
    children: z.tuple([z.unknown(), z.unknown()]),
  }),
]);
export type PlaceBracketOrderCommand = z.infer<typeof PlaceBracketOrderCommand>;
