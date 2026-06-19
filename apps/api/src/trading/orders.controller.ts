import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from "@nestjs/common";
import {
  type Order,
  PlaceOrderCommand,
  type Trade,
} from "@stonks/contracts";
import { TradingService } from "./trading.service.js";

/**
 * 注文 REST エンドポイント（spec §6.8）:
 *   POST   /accounts/:id/orders   発注
 *   DELETE /orders/:id            取消
 *   POST   /orders/evaluate       オープン注文の明示評価（約定→portfolio 反映）
 */
@Controller()
export class OrdersController {
  constructor(private readonly trading: TradingService) {}

  @Post("accounts/:id/orders")
  async place(
    @Param("id") accountId: string,
    @Body() body: unknown,
  ): Promise<Order> {
    // accountId はパスを正準とし、body の accountId は上書きする。
    const raw =
      typeof body === "object" && body !== null
        ? { ...(body as Record<string, unknown>), accountId }
        : { accountId };
    const cmd = PlaceOrderCommand.parse(raw);
    return this.trading.placeOrder(cmd);
  }

  @Delete("orders/:id")
  async cancel(@Param("id") orderId: string): Promise<Order> {
    return this.trading.cancelOrder(orderId);
  }

  @Post("orders/evaluate")
  @HttpCode(200)
  async evaluate(): Promise<{ trades: Trade[] }> {
    const trades = await this.trading.evaluateOpenOrders();
    return { trades };
  }

  @Get("accounts/:id/trades")
  async trades(@Param("id") accountId: string): Promise<Trade[]> {
    return this.trading.listTrades(accountId);
  }
}
