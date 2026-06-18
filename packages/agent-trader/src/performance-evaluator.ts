import Decimal from "decimal.js";
import type {
  BenchmarkComparison,
  BenchmarkId,
  EquityPoint,
  PerformanceEvaluator as IPerformanceEvaluator,
  PerformanceSnapshot,
  PortfolioService,
  PriceProvider,
} from "@stonks/contracts";
import type { PerformanceSnapshotRepository } from "./repository.js";

/** ベンチマーク BUY_AND_HOLD の対象銘柄/指数銘柄を解決する設定。 */
export interface BenchmarkConfig {
  /** BUY_AND_HOLD で買い持ちする銘柄 id（省略時は §の equity 自体を基準にできない→必須）。 */
  buyAndHoldInstrumentId?: string;
  /** 指数ベンチ（TOPIX/SP500）に対応する instrumentId。 */
  indexInstrumentId?: Partial<Record<BenchmarkId, string>>;
}

export interface PerformanceEvaluatorDeps {
  portfolio: PortfolioService;
  priceProvider: PriceProvider;
  /** 任意: スナップショットの永続化（成績の時系列保存）。 */
  snapshots?: PerformanceSnapshotRepository;
  /** ベンチ比較に使う銘柄解決。 */
  benchmark?: BenchmarkConfig;
  /** 年率換算に使う 1 期間あたりの年間期数（既定 252 営業日）。 */
  periodsPerYear?: number;
}

const ZERO = new Decimal(0);

/**
 * 成績評価（ライブ・フォワードテスト。spec §2.7 / §9）。
 *
 * 公正性の原則:
 * - **ルックアヘッド禁止**: 指標は `at` までの EquityPoint のみで計算。
 *   ベンチ価格は range.from / range.to の時点価格を PriceProvider(at) で取得する。
 * - **手数料込み**: エクイティは手数料反映後の口座状態（PortfolioService）由来。
 * - **同条件比較**: 戦略とベンチを同一 range・同一データ源で比較する。
 *
 * 金額は浮動小数を使わず Decimal で計算する（CLAUDE.md §0）。
 */
export class DefaultPerformanceEvaluator implements IPerformanceEvaluator {
  private readonly portfolio: PortfolioService;
  private readonly price: PriceProvider;
  private readonly snapshots: PerformanceSnapshotRepository | undefined;
  private readonly benchmark: BenchmarkConfig;
  private readonly periodsPerYear: number;

  constructor(deps: PerformanceEvaluatorDeps) {
    this.portfolio = deps.portfolio;
    this.price = deps.priceProvider;
    this.snapshots = deps.snapshots;
    this.benchmark = deps.benchmark ?? {};
    this.periodsPerYear = deps.periodsPerYear ?? 252;
  }

  async snapshot(accountId: string, at: Date): Promise<PerformanceSnapshot> {
    const summary = await this.portfolio.getSummary(accountId);
    // at 以前のエクイティ点のみ（ルックアヘッド防止）。
    const history = (
      await this.portfolio.getHistory(accountId, {
        from: new Date(0),
        to: at,
      })
    )
      .slice()
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    const equities = history.map((p) => new Decimal(p.equity));
    const metrics = this.computeMetrics(equities);

    const snapshot: PerformanceSnapshot = {
      accountId,
      ts: at.toISOString(),
      equity: summary.equity.amount,
      cash: summary.cash.amount,
      positionsValue: summary.positionsValue.amount,
      cumulativeReturn: metrics.cumulativeReturn,
      maxDrawdown: metrics.maxDrawdown,
      sharpe: metrics.sharpe,
      winRate: metrics.winRate,
    };

    if (this.snapshots) {
      await this.snapshots.appendSnapshot(snapshot);
    }
    return snapshot;
  }

  async compare(
    accountId: string,
    benchmark: BenchmarkId,
    range: { from: Date; to: Date },
  ): Promise<BenchmarkComparison> {
    // 戦略リターン: range 内のエクイティ点の最初→最後（同条件・手数料込み）。
    const history = (await this.portfolio.getHistory(accountId, range))
      .slice()
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const strategyReturn = periodReturn(history);

    // ベンチリターン: range.from と range.to の時点価格から算出（ルックアヘッド禁止）。
    const instrumentId =
      benchmark === "BUY_AND_HOLD"
        ? this.benchmark.buyAndHoldInstrumentId
        : this.benchmark.indexInstrumentId?.[benchmark];
    if (!instrumentId) {
      throw new Error(
        `no benchmark instrument configured for ${benchmark}`,
      );
    }
    const startPx = new Decimal(
      (await this.price.getLatestPrice(instrumentId, range.from)).amount,
    );
    const endPx = new Decimal(
      (await this.price.getLatestPrice(instrumentId, range.to)).amount,
    );
    const benchmarkReturn = startPx.lte(ZERO)
      ? 0
      : endPx.minus(startPx).dividedBy(startPx).toNumber();

    return {
      accountId,
      benchmark,
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      strategyReturn,
      benchmarkReturn,
      excessReturn: new Decimal(strategyReturn)
        .minus(benchmarkReturn)
        .toNumber(),
    };
  }

  /**
   * エクイティ列から累積リターン・最大DD・シャープ・勝率を計算する。
   *
   * - cumulativeReturn = (最後 / 最初) - 1。
   * - maxDrawdown = ピークからの最大下落率（0..1、正の値で「最大 X% 下落」）。
   * - sharpe = 期間リターンの平均/標準偏差 × sqrt(periodsPerYear)（無リスク金利 0 と仮定）。
   * - winRate = 期間リターンが正であった割合（trade 単位の損益は PortfolioService が
   *   公開しないため、エクイティ変化の up 期間比率を公正な代理指標として用いる）。
   */
  private computeMetrics(equities: Decimal[]): {
    cumulativeReturn: number;
    maxDrawdown: number;
    sharpe: number;
    winRate: number;
  } {
    if (equities.length < 2) {
      return { cumulativeReturn: 0, maxDrawdown: 0, sharpe: 0, winRate: 0 };
    }

    const first = equities[0]!;
    const last = equities[equities.length - 1]!;
    const cumulativeReturn = first.lte(ZERO)
      ? 0
      : last.minus(first).dividedBy(first).toNumber();

    // 最大ドローダウン。
    let peak = equities[0]!;
    let maxDd = ZERO;
    for (const e of equities) {
      if (e.gt(peak)) peak = e;
      if (peak.gt(ZERO)) {
        const dd = peak.minus(e).dividedBy(peak);
        if (dd.gt(maxDd)) maxDd = dd;
      }
    }

    // 期間リターン列。
    const returns: Decimal[] = [];
    for (let i = 1; i < equities.length; i++) {
      const prev = equities[i - 1]!;
      const cur = equities[i]!;
      returns.push(prev.lte(ZERO) ? ZERO : cur.minus(prev).dividedBy(prev));
    }

    const wins = returns.filter((r) => r.gt(ZERO)).length;
    const winRate = returns.length === 0 ? 0 : wins / returns.length;

    const sharpe = this.annualizedSharpe(returns);

    return {
      cumulativeReturn,
      maxDrawdown: maxDd.toNumber(),
      sharpe,
      winRate,
    };
  }

  /** 期間リターン列から年率シャープレシオを計算（無リスク金利 0）。 */
  private annualizedSharpe(returns: Decimal[]): number {
    if (returns.length < 2) return 0;
    const n = new Decimal(returns.length);
    const mean = returns.reduce((a, b) => a.plus(b), ZERO).dividedBy(n);
    const variance = returns
      .reduce((a, r) => a.plus(r.minus(mean).pow(2)), ZERO)
      .dividedBy(n);
    const std = variance.sqrt();
    if (std.lte(ZERO)) return 0;
    return mean
      .dividedBy(std)
      .times(new Decimal(this.periodsPerYear).sqrt())
      .toNumber();
  }
}

/** EquityPoint 列の最初→最後の単純リターン。 */
const periodReturn = (history: EquityPoint[]): number => {
  if (history.length < 2) return 0;
  const first = new Decimal(history[0]!.equity);
  const last = new Decimal(history[history.length - 1]!.equity);
  if (first.lte(ZERO)) return 0;
  return last.minus(first).dividedBy(first).toNumber();
};
