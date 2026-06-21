import { beforeEach, describe, expect, it } from "vitest";
import {
  CapitalGainsTaxEstimate,
  DEFAULT_CAPITAL_GAINS_TAX_RATE,
  type Money,
  type Rate,
  type Trade,
} from "@stonks/contracts";
import { DefaultPortfolioService } from "./portfolio-service.js";
import { InMemoryPortfolioRepository } from "./in-memory-repository.js";
import { FakeFxProvider, FakePriceProvider } from "./fakes.js";

/**
 * 譲渡益課税の概算（spec §2.3 P1）の単体テスト。
 * フェイク（InMemory リポジトリ + Fake 価格/為替）に対してのみ検証する（CLAUDE.md §3）。
 *
 * 検証観点:
 * - 益のみ課税（損失通貨は税額 0、損益通算しない）
 * - 通貨別集計
 * - range 絞り込み（from/to 両端含む = 境界）
 * - 既定率 20.315% と差し替え率の両方
 * - 実現益ゼロ時
 */

const ACC = "acc-tax";
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

const makeSvc = (opts?: { rate?: Rate }) => {
  const repo = new InMemoryPortfolioRepository();
  const price = new FakePriceProvider({
    [TOY]: { amount: "1000", currency: "JPY" },
    [AAPL]: { amount: "100", currency: "USD" },
  });
  const fx = new FakeFxProvider("150");
  const svc = new DefaultPortfolioService({
    repository: repo,
    priceProvider: price,
    fxProvider: fx,
    baseCurrency: "JPY",
    ...(opts?.rate !== undefined ? { capitalGainsTaxRate: opts.rate } : {}),
  });
  return { repo, svc };
};

const RANGE = {
  from: new Date("2026-06-01T00:00:00.000Z"),
  to: new Date("2026-06-30T23:59:59.999Z"),
};

const deposit = (svc: DefaultPortfolioService, amount: Money) =>
  svc.deposit(ACC, amount);

beforeEach(() => {
  tradeSeq = 0;
});

describe("estimateCapitalGainsTax — 既定率（20.315%）", () => {
  it("単一通貨の実現益に既定率を掛けた概算税額を返す", async () => {
    const { svc } = makeSvc();
    await deposit(svc, { amount: "1000000", currency: "JPY" });
    // 100株@1000 で買い、@1500 で売り → 実現益 = (1500-1000)*100 = 50000
    await svc.applyTrade(
      trade({ quantity: 100, price: "1000", executedAt: "2026-06-10T00:00:00.000Z" }),
    );
    await svc.applyTrade(
      trade({
        side: "SELL",
        quantity: 100,
        price: "1500",
        executedAt: "2026-06-11T00:00:00.000Z",
      }),
    );

    const result = await svc.estimateCapitalGainsTax(ACC, RANGE);
    expect(result).toHaveLength(1);
    const jpy = result[0]!;
    expect(jpy.currency).toBe("JPY");
    expect(jpy.realizedGains).toBe("50000");
    expect(jpy.taxRate).toBe(DEFAULT_CAPITAL_GAINS_TAX_RATE);
    // 50000 * 0.20315 = 10157.5
    expect(jpy.estimatedTax).toBe("10157.5");
    // スキーマに通る。
    expect(CapitalGainsTaxEstimate.parse(jpy)).toBeTruthy();
    // 範囲は ISO 文字列に正規化される。
    expect(jpy.range.from).toBe(RANGE.from.toISOString());
    expect(jpy.range.to).toBe(RANGE.to.toISOString());
  });
});

describe("estimateCapitalGainsTax — 損失通貨は税額 0（益のみ課税・通算しない）", () => {
  it("実現損失の通貨は estimatedTax=0、損益通算しない", async () => {
    const { svc } = makeSvc();
    await deposit(svc, { amount: "1000000", currency: "JPY" });
    // 100株@1000 → @800 売り → 実現損 = -20000
    await svc.applyTrade(
      trade({ quantity: 100, price: "1000", executedAt: "2026-06-10T00:00:00.000Z" }),
    );
    await svc.applyTrade(
      trade({
        side: "SELL",
        quantity: 100,
        price: "800",
        executedAt: "2026-06-11T00:00:00.000Z",
      }),
    );

    const result = await svc.estimateCapitalGainsTax(ACC, RANGE);
    expect(result).toHaveLength(1);
    const jpy = result[0]!;
    expect(jpy.realizedGains).toBe("-20000");
    // 損失は税額 0（max(gains,0)*rate）。
    expect(jpy.estimatedTax).toBe("0");
  });
});

describe("estimateCapitalGainsTax — 通貨別集計", () => {
  it("JPY と USD を通貨ごとに分けて集計する（損益通算しない）", async () => {
    const { svc } = makeSvc();
    await deposit(svc, { amount: "1000000", currency: "JPY" });
    await deposit(svc, { amount: "100000", currency: "USD" });

    // JPY: 実現益 +50000
    await svc.applyTrade(
      trade({ quantity: 100, price: "1000", executedAt: "2026-06-10T00:00:00.000Z" }),
    );
    await svc.applyTrade(
      trade({
        side: "SELL",
        quantity: 100,
        price: "1500",
        executedAt: "2026-06-11T00:00:00.000Z",
      }),
    );
    // USD: 実現損 -1000 (100株 @100 → @90)
    await svc.applyTrade(
      trade({
        instrumentId: AAPL,
        currency: "USD",
        quantity: 100,
        price: "100",
        executedAt: "2026-06-12T00:00:00.000Z",
      }),
    );
    await svc.applyTrade(
      trade({
        instrumentId: AAPL,
        currency: "USD",
        side: "SELL",
        quantity: 100,
        price: "90",
        executedAt: "2026-06-13T00:00:00.000Z",
      }),
    );

    const result = await svc.estimateCapitalGainsTax(ACC, RANGE);
    expect(result).toHaveLength(2);
    const byCcy = Object.fromEntries(result.map((r) => [r.currency, r]));
    expect(byCcy.JPY!.realizedGains).toBe("50000");
    expect(byCcy.JPY!.estimatedTax).toBe("10157.5");
    expect(byCcy.USD!.realizedGains).toBe("-1000");
    expect(byCcy.USD!.estimatedTax).toBe("0");
    // 通算していない（JPY 益と USD 損が相殺されない）。
  });
});

describe("estimateCapitalGainsTax — range 絞り込み（境界含む）", () => {
  it("from/to 両端を含み、範囲外の closedAt は除外する", async () => {
    const { svc } = makeSvc();
    await deposit(svc, { amount: "10000000", currency: "JPY" });

    const buyAt = "2026-05-01T00:00:00.000Z";
    // 3回 100株ずつ買い、それぞれ別日に売り。実現益は各 +50000。
    for (let i = 0; i < 3; i++) {
      await svc.applyTrade(
        trade({ quantity: 100, price: "1000", executedAt: buyAt }),
      );
    }
    // 範囲前（除外）
    await svc.applyTrade(
      trade({
        side: "SELL",
        quantity: 100,
        price: "1500",
        executedAt: "2026-05-31T23:59:59.999Z",
      }),
    );
    // from 境界（含む）
    await svc.applyTrade(
      trade({
        side: "SELL",
        quantity: 100,
        price: "1500",
        executedAt: "2026-06-01T00:00:00.000Z",
      }),
    );
    // to 境界（含む）
    await svc.applyTrade(
      trade({
        side: "SELL",
        quantity: 100,
        price: "1500",
        executedAt: "2026-06-30T23:59:59.999Z",
      }),
    );

    const result = await svc.estimateCapitalGainsTax(ACC, RANGE);
    expect(result).toHaveLength(1);
    // 範囲内 2 件分のみ = 100000（範囲前の 1 件は除外）。
    expect(result[0]!.realizedGains).toBe("100000");
  });
});

describe("estimateCapitalGainsTax — 差し替え率", () => {
  it("capitalGainsTaxRate を設定すると概算率が差し替わる", async () => {
    const { svc } = makeSvc({ rate: "0.30" });
    await deposit(svc, { amount: "1000000", currency: "JPY" });
    await svc.applyTrade(
      trade({ quantity: 100, price: "1000", executedAt: "2026-06-10T00:00:00.000Z" }),
    );
    await svc.applyTrade(
      trade({
        side: "SELL",
        quantity: 100,
        price: "1500",
        executedAt: "2026-06-11T00:00:00.000Z",
      }),
    );

    const result = await svc.estimateCapitalGainsTax(ACC, RANGE);
    expect(result[0]!.taxRate).toBe("0.30");
    // 50000 * 0.30 = 15000
    expect(result[0]!.estimatedTax).toBe("15000");
  });

  it("NISA 等の非課税は率 0 で概算税額 0 になる", async () => {
    const { svc } = makeSvc({ rate: "0" });
    await deposit(svc, { amount: "1000000", currency: "JPY" });
    await svc.applyTrade(
      trade({ quantity: 100, price: "1000", executedAt: "2026-06-10T00:00:00.000Z" }),
    );
    await svc.applyTrade(
      trade({
        side: "SELL",
        quantity: 100,
        price: "1500",
        executedAt: "2026-06-11T00:00:00.000Z",
      }),
    );

    const result = await svc.estimateCapitalGainsTax(ACC, RANGE);
    expect(result[0]!.realizedGains).toBe("50000");
    expect(result[0]!.estimatedTax).toBe("0");
  });
});

describe("estimateCapitalGainsTax — 実現益ゼロ時", () => {
  it("対象期間に実現損益が無ければ空配列を返す", async () => {
    const { svc } = makeSvc();
    await deposit(svc, { amount: "1000000", currency: "JPY" });
    // 買いのみ（クローズしていない → RealizedPnl 無し）。
    await svc.applyTrade(
      trade({ quantity: 100, price: "1000", executedAt: "2026-06-10T00:00:00.000Z" }),
    );

    const result = await svc.estimateCapitalGainsTax(ACC, RANGE);
    expect(result).toEqual([]);
  });

  it("実現益が丁度 0 の通貨でも 1 件返り、税額 0 になる", async () => {
    const { svc } = makeSvc();
    await deposit(svc, { amount: "1000000", currency: "JPY" });
    // 100株@1000 → @1000 売り（手数料 0）→ 実現益 0。
    await svc.applyTrade(
      trade({ quantity: 100, price: "1000", executedAt: "2026-06-10T00:00:00.000Z" }),
    );
    await svc.applyTrade(
      trade({
        side: "SELL",
        quantity: 100,
        price: "1000",
        executedAt: "2026-06-11T00:00:00.000Z",
      }),
    );

    const result = await svc.estimateCapitalGainsTax(ACC, RANGE);
    expect(result).toHaveLength(1);
    expect(result[0]!.realizedGains).toBe("0");
    expect(result[0]!.estimatedTax).toBe("0");
  });
});
