import { describe, expect, it } from "vitest";
import type {
  FeeModel,
  FillModel,
  Order,
  TradingEngine,
} from "@stonks/contracts";
import { StandardTradingEngine } from "./engine.js";
import { StandardFeeModel } from "./fee-model.js";
import { SlippageFillModel } from "./fill-model.js";
import {
  InMemoryAccountStateProvider,
  InMemoryInstrumentProvider,
  InMemoryOrderRepository,
} from "./in-memory.js";
import { JP_INSTRUMENT } from "./test-helpers.js";

/**
 * 契約遵守テスト（CLAUDE.md §3）: 公開実装が contracts の IF に構造的に一致することを保証。
 * 代入が型チェックを通ること自体が検証であり、実行時は最小の健全性のみ確認する。
 */

describe("contract conformance", () => {
  it("StandardTradingEngine satisfies TradingEngine", () => {
    const engine: TradingEngine = new StandardTradingEngine({
      orders: new InMemoryOrderRepository(),
      accountState: new InMemoryAccountStateProvider(),
      instruments: new InMemoryInstrumentProvider([JP_INSTRUMENT]),
      feeModel: new StandardFeeModel(),
      fillModel: new SlippageFillModel(),
    });
    expect(typeof engine.placeOrder).toBe("function");
    expect(typeof engine.cancelOrder).toBe("function");
    expect(typeof engine.evaluateOpenOrders).toBe("function");
    // Phase 5: 複合注文の optional メソッドを実装している。
    expect(typeof engine.placeBracketOrder).toBe("function");
    expect(typeof engine.cancelOrderGroup).toBe("function");
  });

  it("StandardFeeModel satisfies FeeModel and returns Money", () => {
    const feeModel: FeeModel = new StandardFeeModel();
    const { fee } = feeModel.calculate({
      instrument: JP_INSTRUMENT,
      side: "BUY",
      quantity: 100,
      price: "1000",
    });
    expect(fee.currency).toBe("JPY");
    expect(typeof fee.amount).toBe("string");
  });

  it("SlippageFillModel satisfies FillModel", () => {
    const fillModel: FillModel = new SlippageFillModel({ slippageRate: "0" });
    const order: Order = {
      id: "o1",
      accountId: "a1",
      instrumentId: JP_INSTRUMENT.id,
      side: "BUY",
      type: "MARKET",
      quantity: 100,
      filledQuantity: 0,
      timeInForce: "DAY",
      status: "PENDING",
      createdAt: "2026-06-19T00:00:00Z",
      updatedAt: "2026-06-19T00:00:00Z",
    };
    const fill = fillModel.tryFill(order, "1000");
    expect(fill).not.toBeNull();
    expect(fill!.quantity).toBe(100);
    expect(fill!.price).toBe("1000");
  });
});
