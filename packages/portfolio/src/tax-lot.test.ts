import Decimal from "decimal.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { CostBasisMethod, Trade } from "@stonks/contracts";
import { DefaultPortfolioService } from "./portfolio-service.js";
import { InMemoryPortfolioRepository } from "./in-memory-repository.js";
import { FakeFxProvider, FakePriceProvider } from "./fakes.js";

const ACC = "acc-1";
const TOY = "toyota";

let tradeSeq = 0;
const trade = (over: Partial<Trade>): Trade => ({
  id: `t-${++tradeSeq}`,
  orderId: `o-${tradeSeq}`,
  accountId: ACC,
  instrumentId: TOY,
  side: "BUY",
  quantity: 100,
  price: "1000",
  fee: "0",
  currency: "JPY",
  executedAt: "2026-06-19T00:00:00.000Z",
  ...over,
});

const makeSvc = (costBasisMethod?: CostBasisMethod) => {
  const repo = new InMemoryPortfolioRepository();
  const svc = new DefaultPortfolioService({
    repository: repo,
    priceProvider: new FakePriceProvider({ [TOY]: { amount: "1000", currency: "JPY" } }),
    fxProvider: new FakeFxProvider("150"),
    baseCurrency: "JPY",
    ...(costBasisMethod ? { costBasisMethod } : {}),
  });
  return { repo, svc };
};

/** 取得日違いの 2 ロット（100@1000, 100@1200）を建ててから sellQty を売る共通シナリオ。 */
const buyTwoLotsThenSell = async (
  svc: DefaultPortfolioService,
  sellQty: number,
) => {
  await svc.deposit(ACC, { amount: "10000000", currency: "JPY" });
  await svc.applyTrade(
    trade({ quantity: 100, price: "1000", fee: "0", executedAt: "2026-06-19T01:00:00.000Z" }),
  );
  await svc.applyTrade(
    trade({ quantity: 100, price: "1200", fee: "0", executedAt: "2026-06-19T02:00:00.000Z" }),
  );
  await svc.applyTrade(
    trade({ side: "SELL", quantity: sellQty, price: "1500", fee: "0", executedAt: "2026-06-19T03:00:00.000Z" }),
  );
};

beforeEach(() => {
  tradeSeq = 0;
});

describe("税ロット取得 — applyBuy", () => {
  it("買いごとに 1 ロットを起こし、取得単価は手数料込み", async () => {
    const { svc } = makeSvc("FIFO");
    await svc.deposit(ACC, { amount: "1000000", currency: "JPY" });
    await svc.applyTrade(trade({ quantity: 100, price: "1000", fee: "100" }));

    const lots = await svc.getTaxLots(ACC);
    expect(lots).toHaveLength(1);
    expect(lots[0]!.quantity).toBe(100);
    expect(lots[0]!.remainingQuantity).toBe(100);
    // costBasis = (100*1000 + 100) / 100 = 1001
    expect(new Decimal(lots[0]!.costBasis).equals("1001")).toBe(true);
  });
});

describe("取り崩し — FIFO", () => {
  it("古いロットから取り崩し、取得原価はロット原価合計", async () => {
    const { repo, svc } = makeSvc("FIFO");
    await buyTwoLotsThenSell(svc, 150);

    const lots = await svc.getTaxLots(ACC);
    // lot1(1000) 完全取崩し、lot2(1200) は 50 残
    expect(lots[0]!.remainingQuantity).toBe(0);
    expect(lots[1]!.remainingQuantity).toBe(50);

    const withLots = await repo.listRealizedPnlWithLots(ACC);
    expect(withLots).toHaveLength(1);
    expect(withLots[0]!.method).toBe("FIFO");
    expect(withLots[0]!.lots).toHaveLength(2);
    // costBasis = 100*1000 + 50*1200 = 160000、realized = 225000 - 160000 = 65000
    expect(new Decimal(withLots[0]!.costBasis).equals("160000")).toBe(true);
    expect(new Decimal(withLots[0]!.realized).equals("65000")).toBe(true);
  });
});

describe("取り崩し — LIFO", () => {
  it("新しいロットから取り崩す", async () => {
    const { repo, svc } = makeSvc("LIFO");
    await buyTwoLotsThenSell(svc, 150);

    const lots = await svc.getTaxLots(ACC);
    // lot2(1200) 完全取崩し、lot1(1000) は 50 残
    expect(lots[0]!.remainingQuantity).toBe(50);
    expect(lots[1]!.remainingQuantity).toBe(0);

    const withLots = await repo.listRealizedPnlWithLots(ACC);
    // costBasis = 100*1200 + 50*1000 = 170000、realized = 225000 - 170000 = 55000
    expect(new Decimal(withLots[0]!.costBasis).equals("170000")).toBe(true);
    expect(new Decimal(withLots[0]!.realized).equals("55000")).toBe(true);
  });
});

describe("取り崩し — AVERAGE（既定・後方互換）", () => {
  it("取得原価は平均建値×数量（Phase 2 の RealizedPnl と一致）", async () => {
    const { repo, svc } = makeSvc(); // 既定 AVERAGE
    await buyTwoLotsThenSell(svc, 150);

    // avg = (100000+120000)/200 = 1100、costBasis = 1100*150 = 165000、realized = 60000
    const realized = await repo.listRealizedPnl(ACC);
    expect(new Decimal(realized[0]!.costBasis).equals("165000")).toBe(true);
    expect(new Decimal(realized[0]!.realized).equals("60000")).toBe(true);

    // 残ロットは FIFO 順で取り崩し（lot1 全消化、lot2 に 50 残）。
    const open = await svc.getTaxLots(ACC, true);
    expect(open).toHaveLength(1);
    expect(open[0]!.remainingQuantity).toBe(50);
  });
});

describe("MARGIN 建玉", () => {
  it("Trade.marginType=MARGIN を建玉に伝播する", async () => {
    const { repo, svc } = makeSvc();
    await svc.deposit(ACC, { amount: "1000000", currency: "JPY" });
    await svc.applyTrade(trade({ quantity: 100, price: "1000", marginType: "MARGIN" }));

    const pos = await repo.getPosition(ACC, TOY);
    expect(pos?.marginType).toBe("MARGIN");
  });
});
