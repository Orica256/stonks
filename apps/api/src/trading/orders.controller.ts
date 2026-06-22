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
  PlaceBracketOrderCommand,
  PlaceOrderCommand,
  type Trade,
} from "@stonks/contracts";
// NestJS の DI は実行時にクラス参照を要する（reflect-metadata）。`import type` 化禁止。
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TradingService } from "./trading.service.js";

/**
 * 注文 REST エンドポイント（spec §6.8 ＋ Phase 5 複合注文）:
 *   POST   /accounts/:id/orders          発注（単発）
 *   POST   /accounts/:id/orders/bracket  複合発注（OCO / IFD / bracket。Phase 5）
 *   DELETE /orders/:id                   取消（単発）
 *   DELETE /orders/groups/:linkGroupId   グループ取消（Phase 5）
 *   POST   /orders/evaluate              オープン注文の明示評価（約定→portfolio 反映）
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

  /**
   * 複合発注（OCO / IFD / bracket。Phase 5。spec §2.2 P2）。
   *
   * 各 leg/parent/child の accountId はパスを正準として注入する（単発と同じ規約）。
   * leg の中身は contracts では z.unknown() で、price 妥当性等は trading-engine が
   * PlaceOrderCommand で個別検証する（rationale 必須は AI 発注のみ。通常注文系の延長）。
   */
  @Post("accounts/:id/orders/bracket")
  async placeBracket(
    @Param("id") accountId: string,
    @Body() body: unknown,
  ): Promise<Order[]> {
    const cmd = PlaceBracketOrderCommand.parse(
      injectAccountId(body, accountId),
    );
    return this.trading.placeBracketOrder(cmd);
  }

  @Delete("orders/:id")
  async cancel(@Param("id") orderId: string): Promise<Order> {
    return this.trading.cancelOrder(orderId);
  }

  /**
   * 複合注文グループの一括取消（Phase 5）。
   * linkGroupId に属するオープン/WAITING 注文を CANCELLED にして返す。
   */
  @Delete("orders/groups/:linkGroupId")
  async cancelGroup(
    @Param("linkGroupId") linkGroupId: string,
  ): Promise<Order[]> {
    return this.trading.cancelOrderGroup(linkGroupId);
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

/** オブジェクトなら accountId を上書き注入する（複合発注の各 leg 用）。 */
function withAccountId(raw: unknown, accountId: string): unknown {
  return typeof raw === "object" && raw !== null
    ? { ...(raw as Record<string, unknown>), accountId }
    : raw;
}

/**
 * 複合発注 body の各 leg/parent/children に accountId（パス正準）を注入する。
 * kind に応じて legs / parent+children へ展開する（contracts の leg は z.unknown()）。
 */
function injectAccountId(body: unknown, accountId: string): unknown {
  if (typeof body !== "object" || body === null) return body;
  const b = body as Record<string, unknown>;
  const out: Record<string, unknown> = { ...b };
  if (Array.isArray(b.legs)) {
    out.legs = b.legs.map((leg) => withAccountId(leg, accountId));
  }
  if ("parent" in b) {
    out.parent = withAccountId(b.parent, accountId);
  }
  if (Array.isArray(b.children)) {
    out.children = b.children.map((c) => withAccountId(c, accountId));
  }
  return out;
}
