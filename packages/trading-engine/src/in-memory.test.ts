import { describe, expect, it } from "vitest";
import type { Order } from "@stonks/contracts";
import { InMemoryOrderRepository } from "./in-memory.js";
import { JP_INSTRUMENT } from "./test-helpers.js";

/**
 * in-memory ポート実装の単体テスト。
 * listByAccount は一覧表示用の読み取りで、状態に依らず全件を createdAt 降順で返す。
 */

const makeOrder = (over: Partial<Order> & Pick<Order, "id">): Order => ({
  accountId: "acc-1",
  instrumentId: JP_INSTRUMENT.id,
  side: "BUY",
  type: "MARKET",
  quantity: 100,
  filledQuantity: 0,
  timeInForce: "DAY",
  status: "PENDING",
  createdAt: "2026-06-19T00:00:00Z",
  updatedAt: "2026-06-19T00:00:00Z",
  ...over,
});

describe("InMemoryOrderRepository.listByAccount", () => {
  it("口座で絞り込み、状態に依らず全件を新しい順で返す", async () => {
    const repo = new InMemoryOrderRepository();
    await repo.save(
      makeOrder({ id: "o1", accountId: "acc-1", createdAt: "2026-06-19T01:00:00Z" }),
    );
    await repo.save(
      makeOrder({
        id: "o2",
        accountId: "acc-1",
        status: "FILLED",
        createdAt: "2026-06-19T03:00:00Z",
      }),
    );
    await repo.save(
      makeOrder({
        id: "o3",
        accountId: "acc-1",
        status: "CANCELLED",
        createdAt: "2026-06-19T02:00:00Z",
      }),
    );
    // 別口座の注文は含めない。
    await repo.save(
      makeOrder({ id: "o4", accountId: "acc-2", createdAt: "2026-06-19T09:00:00Z" }),
    );

    const result = await repo.listByAccount("acc-1");

    // createdAt 降順（新しい順）かつ口座一致のみ。
    expect(result.map((o) => o.id)).toEqual(["o2", "o3", "o1"]);
  });

  it("該当注文が無ければ空配列を返す", async () => {
    const repo = new InMemoryOrderRepository();
    await repo.save(makeOrder({ id: "o1", accountId: "acc-1" }));

    expect(await repo.listByAccount("acc-unknown")).toEqual([]);
  });
});
