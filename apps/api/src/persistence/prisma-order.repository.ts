import type { Order } from "@stonks/contracts";
import type { OrderRepository } from "@stonks/trading-engine";
import type { PrismaClient } from "@stonks/db";
import { toOrder } from "./mappers.js";

/**
 * trading-engine の OrderRepository ポートを Prisma で実装する（本番リポジトリ）。
 * テストは trading-engine の InMemoryOrderRepository を使うため、ここは typecheck で型整合を担保する。
 */
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly db: PrismaClient) {}

  async save(order: Order): Promise<void> {
    await this.db.order.create({ data: this.toRow(order) });
  }

  async findById(orderId: string): Promise<Order | null> {
    const row = await this.db.order.findUnique({ where: { id: orderId } });
    return row ? toOrder(row) : null;
  }

  async findOpen(): Promise<Order[]> {
    const rows = await this.db.order.findMany({
      where: { status: { in: ["PENDING", "PARTIALLY_FILLED"] } },
    });
    return rows.map(toOrder);
  }

  /**
   * 複合注文の linkGroupId に属する全注文を返す（Phase 5。OCO/bracket カスケード用）。
   * 状態に依らず全件返す（呼び出し側が状態で絞る）。schema の `@@index([linkGroupId])` を使う。
   */
  async findByLinkGroupId(linkGroupId: string): Promise<Order[]> {
    const rows = await this.db.order.findMany({ where: { linkGroupId } });
    return rows.map(toOrder);
  }

  /**
   * 指定注文を親（parentOrderId）に持つ子注文を返す（Phase 5。IFD カスケード用）。
   * 状態に依らず全件返す。schema の `@@index([parentOrderId])` を使う。
   */
  async findByParentOrderId(parentOrderId: string): Promise<Order[]> {
    const rows = await this.db.order.findMany({ where: { parentOrderId } });
    return rows.map(toOrder);
  }

  async update(order: Order): Promise<void> {
    await this.db.order.update({
      where: { id: order.id },
      data: {
        filledQuantity: order.filledQuantity,
        status: order.status,
        limitPrice: order.limitPrice ?? null,
        stopPrice: order.stopPrice ?? null,
        // Phase 5: 約定/取消カスケードで子が発効（WAITING→ACTIVE）し得るため activation も更新する。
        activation: order.activation ?? "ACTIVE",
        updatedAt: new Date(order.updatedAt),
      },
    });
  }

  private toRow(order: Order) {
    return {
      id: order.id,
      accountId: order.accountId,
      instrumentId: order.instrumentId,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      limitPrice: order.limitPrice ?? null,
      stopPrice: order.stopPrice ?? null,
      timeInForce: order.timeInForce,
      // Phase 3: 資金区分。未指定は CASH（DB 既定に頼らず明示）。
      marginType: order.marginType ?? "CASH",
      // Phase 5: 複合注文の link フィールド（単発は NULL/ACTIVE で従来挙動）。
      linkGroupId: order.linkGroupId ?? null,
      linkType: order.linkType ?? null,
      parentOrderId: order.parentOrderId ?? null,
      activation: order.activation ?? "ACTIVE",
      status: order.status,
      createdAt: new Date(order.createdAt),
      updatedAt: new Date(order.updatedAt),
    };
  }
}
