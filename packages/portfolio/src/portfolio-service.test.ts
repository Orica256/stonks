import Decimal from "decimal.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { Money, Trade } from "@stonks/contracts";
import { DefaultPortfolioService } from "./portfolio-service.js";
import { InMemoryPortfolioRepository } from "./in-memory-repository.js";
import { FakeFxProvider, FakePriceProvider } from "./fakes.js";

const ACC = "acc-1";
const TOY = "toyota"; // JPY 銘柄
const AAPL = "aapl"; // USD 銘柄

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

const makeSvc = (opts?: {
  prices?: Record<string, Money>;
  usdJpy?: string;
  base?: "JPY" | "USD";
}) => {
  const repo = new InMemoryPortfolioRepository();
  const price = new FakePriceProvider(
    opts?.prices ?? { [TOY]: { amount: "1000", currency: "JPY" } },
  );
  const fx = new FakeFxProvider(opts?.usdJpy ?? "150");
  const svc = new DefaultPortfolioService({
    repository: repo,
    priceProvider: price,
    fxProvider: fx,
    baseCurrency: opts?.base ?? "JPY",
  });
  return { repo, price, fx, svc };
};

/** 現金残高 = CashLedger 合計 を全通貨で検証（spec §5.2）。 */
const assertCashMatchesLedger = async (
  repo: InMemoryPortfolioRepository,
  accountId: string,
) => {
  const balances = await repo.listCashBalances(accountId);
  const ledger = await repo.listLedgerEntries(accountId);
  for (const b of balances) {
    const sum = ledger
      .filter((e) => e.currency === b.currency && e.type !== "REALIZED_PNL")
      .reduce((acc, e) => acc.plus(e.amount), new Decimal(0));
    expect(new Decimal(b.amount).equals(sum)).toBe(true);
  }
};

beforeEach(() => {
  tradeSeq = 0;
});

describe("applyTrade — 平均取得単価（買い増し）", () => {
  it("手数料込みで加重平均する", async () => {
    const { repo, svc } = makeSvc();
    await svc.deposit(ACC, { amount: "1000000", currency: "JPY" });
    // 100株@1000 fee100 → costTotal 100100, avg 1001
    await svc.applyTrade(trade({ quantity: 100, price: "1000", fee: "100" }));
    // +100株@1200 fee200 → costTotal 100100 + 120200 = 220300 / 200 = 1101.5
    await svc.applyTrade(trade({ quantity: 100, price: "1200", fee: "200" }));

    const pos = await repo.getPosition(ACC, TOY);
    expect(pos?.quantity).toBe(200);
    expect(new Decimal(pos!.avgCost).equals("1101.5")).toBe(true);
    await assertCashMatchesLedger(repo, ACC);
  });
});

describe("applyTrade — 一部売却の実現損益", () => {
  it("実現損益 = 売却代金 - 平均建値×数量 - 手数料、平均建値は不変", async () => {
    const { repo, svc } = makeSvc();
    await svc.deposit(ACC, { amount: "1000000", currency: "JPY" });
    await svc.applyTrade(trade({ quantity: 100, price: "1000", fee: "0" })); // avg 1000
    // 40株を@1500で売却 fee50 → realized = 60000 - 40000 - 50 = 19950
    await svc.applyTrade(
      trade({ side: "SELL", quantity: 40, price: "1500", fee: "50" }),
    );

    const pos = await repo.getPosition(ACC, TOY);
    expect(pos?.quantity).toBe(60);
    expect(new Decimal(pos!.avgCost).equals("1000")).toBe(true); // 売却で建値は変わらない

    const realized = await repo.listRealizedPnl(ACC);
    expect(realized).toHaveLength(1);
    expect(new Decimal(realized[0]!.realized).equals("19950")).toBe(true);
    expect(new Decimal(realized[0]!.costBasis).equals("40000")).toBe(true);
    expect(new Decimal(realized[0]!.proceeds).equals("60000")).toBe(true);
    await assertCashMatchesLedger(repo, ACC);
  });
});

describe("applyTrade — 全決済", () => {
  it("数量0でポジション削除、合計実現損益が正しい", async () => {
    const { repo, svc } = makeSvc();
    await svc.deposit(ACC, { amount: "1000000", currency: "JPY" });
    await svc.applyTrade(trade({ quantity: 100, price: "1000", fee: "0" }));
    await svc.applyTrade(
      trade({ side: "SELL", quantity: 100, price: "900", fee: "0" }),
    ); // realized = 90000 - 100000 = -10000

    expect(await repo.getPosition(ACC, TOY)).toBeUndefined();
    const summary = await svc.getSummary(ACC);
    expect(new Decimal(summary.realizedPnl.amount).equals("-10000")).toBe(true);
    await assertCashMatchesLedger(repo, ACC);
  });
});

describe("invariant — 売り越し禁止 / 数量整合", () => {
  it("保有を超える売却を拒否する", async () => {
    const { svc } = makeSvc();
    await svc.deposit(ACC, { amount: "1000000", currency: "JPY" });
    await svc.applyTrade(trade({ quantity: 100, price: "1000" }));
    await expect(
      svc.applyTrade(trade({ side: "SELL", quantity: 101, price: "1000" })),
    ).rejects.toThrow(/cannot sell/);
  });

  it("ポジション数量 = Trade の積み上げ", async () => {
    const { repo, svc } = makeSvc();
    await svc.deposit(ACC, { amount: "10000000", currency: "JPY" });
    await svc.applyTrade(trade({ quantity: 100 }));
    await svc.applyTrade(trade({ quantity: 50 }));
    await svc.applyTrade(trade({ side: "SELL", quantity: 30, price: "1100" }));
    const pos = await repo.getPosition(ACC, TOY);
    expect(pos?.quantity).toBe(120); // 100 + 50 - 30
  });
});

describe("getPositions — 評価額・含み損益（フェイク PriceProvider）", () => {
  it("時価で marketValue / unrealizedPnl / pct を算出", async () => {
    const { svc, price } = makeSvc();
    await svc.deposit(ACC, { amount: "1000000", currency: "JPY" });
    await svc.applyTrade(trade({ quantity: 100, price: "1000", fee: "0" })); // avg 1000
    price.setPrice(TOY, { amount: "1250", currency: "JPY" });

    const [view] = await svc.getPositions(ACC);
    expect(view).toBeDefined();
    expect(new Decimal(view!.marketValue.amount).equals("125000")).toBe(true);
    expect(new Decimal(view!.unrealizedPnl.amount).equals("25000")).toBe(true);
    expect(view!.unrealizedPnlPct).toBeCloseTo(25, 10);
  });
});

describe("getSummary — 基軸換算（フェイク FxProvider）", () => {
  it("JPY 基軸で USD 建てを 150 で換算合算", async () => {
    const { svc } = makeSvc({
      base: "JPY",
      usdJpy: "150",
      prices: {
        [TOY]: { amount: "1000", currency: "JPY" },
        [AAPL]: { amount: "200", currency: "USD" },
      },
    });
    // JPY 口座: 100株@1000 → cost 100000
    await svc.deposit(ACC, { amount: "500000", currency: "JPY" });
    await svc.deposit(ACC, { amount: "10000", currency: "USD" });
    await svc.applyTrade(
      trade({ instrumentId: TOY, quantity: 100, price: "1000", fee: "0", currency: "JPY" }),
    );
    // USD 口座: 10株@180 → cost 1800、時価 200 → +200 含み益
    await svc.applyTrade(
      trade({ instrumentId: AAPL, quantity: 10, price: "180", fee: "0", currency: "USD" }),
    );

    const s = await svc.getSummary(ACC);
    expect(s.baseCurrency).toBe("JPY");
    // cash: JPY (500000-100000)=400000 + USD (10000-1800)=8200 *150 = 1,230,000 → 1,630,000
    expect(new Decimal(s.cash.amount).equals("1630000")).toBe(true);
    // positions: TOY 100*1000=100000 + AAPL 10*200=2000 *150=300000 → 400000
    expect(new Decimal(s.positionsValue.amount).equals("400000")).toBe(true);
    // equity = 1,630,000 + 400,000 = 2,030,000
    expect(new Decimal(s.equity.amount).equals("2030000")).toBe(true);
    // unrealized: TOY 0 + AAPL (200-180)*10=200 USD *150 = 30,000
    expect(new Decimal(s.unrealizedPnl.amount).equals("30000")).toBe(true);
  });
});

describe("getHistory — 資産推移", () => {
  it("約定ごとにエクイティ点を記録し range で絞る", async () => {
    const { svc } = makeSvc();
    await svc.deposit(ACC, { amount: "1000000", currency: "JPY" });
    await svc.applyTrade(
      trade({ quantity: 100, price: "1000", fee: "0", executedAt: "2026-06-19T01:00:00.000Z" }),
    );
    await svc.applyTrade(
      trade({ quantity: 50, price: "1000", fee: "0", executedAt: "2026-06-19T02:00:00.000Z" }),
    );

    const all = await svc.getHistory(ACC, {
      from: new Date("2026-06-19T00:00:00Z"),
      to: new Date("2026-06-19T23:00:00Z"),
    });
    expect(all).toHaveLength(2);
    // エクイティは建値ベースで現金供給額（=入金）を保存する: 1,000,000
    expect(new Decimal(all[0]!.equity).equals("1000000")).toBe(true);

    const windowed = await svc.getHistory(ACC, {
      from: new Date("2026-06-19T01:30:00Z"),
      to: new Date("2026-06-19T23:00:00Z"),
    });
    expect(windowed).toHaveLength(1);
  });
});
