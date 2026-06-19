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

  async update(order: Order): Promise<void> {
    await this.db.order.update({
      where: { id: order.id },
      data: {
        filledQuantity: order.filledQuantity,
        status: order.status,
        limitPrice: order.limitPrice ?? null,
        stopPrice: order.stopPrice ?? null,
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
      status: order.status,
      createdAt: new Date(order.createdAt),
      updatedAt: new Date(order.updatedAt),
    };
  }
}
