import type { Order } from "@stonks/contracts";

/**
 * trading-engine 内部の最小ポート（依存性逆転）。
 *
 * 永続化（db）には直接依存せず、ここで定義した IF に対して実装/フェイクを注入する
 * （CLAUDE.md §0・§4.3）。現金/保有の読み取りと銘柄解決は contracts の
 * AccountStateProvider / InstrumentResolver（B2）を直接使う（再 export）。
 */

/** 注文の永続化ポート。 */
export interface OrderRepository {
  /** 新規注文を保存する。 */
  save(order: Order): Promise<void>;
  /** id で 1 件取得。なければ null。 */
  findById(orderId: string): Promise<Order | null>;
  /** 評価対象になり得るオープン注文（PENDING / PARTIALLY_FILLED）を返す。 */
  findOpen(): Promise<Order[]>;
  /** 既存注文を更新する（状態遷移・約定数量の反映）。 */
  update(order: Order): Promise<void>;
  /**
   * 複合注文の `linkGroupId` に属する全注文を返す（Phase 5。OCO/bracket カスケード用）。
   * 状態（オープン/WAITING/約定済み）に依らず全件返す（呼び出し側が状態で絞る）。
   */
  findByLinkGroupId(linkGroupId: string): Promise<Order[]>;
  /**
   * 指定注文を親（`parentOrderId`）に持つ子注文を返す（Phase 5。IFD カスケード用）。
   * 状態に依らず全件返す。
   */
  findByParentOrderId(parentOrderId: string): Promise<Order[]>;
  /**
   * 指定口座の全注文を返す（一覧表示用の読み取り）。
   * 状態（オープン/WAITING/約定済み/取消）に依らず全件返す。
   * 並び順は createdAt 降順（新しい順）。
   */
  listByAccount(accountId: string): Promise<Order[]>;
}

// 現金/保有の読み取りと銘柄解決は contracts の正式 IF を使う（B2）。
// InstrumentProvider は後方互換のため InstrumentResolver の別名で残す。
export type {
  AccountStateProvider,
  InstrumentResolver,
  InstrumentResolver as InstrumentProvider,
} from "@stonks/contracts";
