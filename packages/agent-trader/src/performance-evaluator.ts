import Decimal from "decimal.js";
import type {
  BenchmarkComparison,
  BenchmarkComparisonResult,
  BenchmarkId,
  BenchmarkUnavailableReason,
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
 * ベンチ比較が公正に成立しないときに投げる型付きエラー（spec §2.7 P1 / §9）。
 *
 * `BenchmarkComparison` 契約は nullable フィールドを持たないため、
 * 「ベンチ未提供」は値を捏造せず例外で表現する。呼び出し側（api 等）は
 * `reason` を見て「比較不能」を明示的に扱える（推測リターンを出さない）。
 */
export class BenchmarkUnavailableError extends Error {
  constructor(
    readonly benchmark: BenchmarkId,
    readonly reason: BenchmarkUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = "BenchmarkUnavailableError";
  }
}

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

    // B2: 勝率は trade 単位の実現損益から計算する（PortfolioService.getRealizedPnl）。
    // at までにクローズした取引のみ（ルックアヘッド防止）。実現損益が皆無なら
    // エクイティ変化の up 期間比率を従来どおり代理指標として用いる。
    const realized = (await this.portfolio.getRealizedPnl(accountId)).filter(
      (r) => new Date(r.closedAt).getTime() <= at.getTime(),
    );
    const winRate =
      realized.length > 0
        ? realized.filter((r) => new Decimal(r.realized).gt(ZERO)).length /
          realized.length
        : metrics.winRate;

    const snapshot: PerformanceSnapshot = {
      accountId,
      ts: at.toISOString(),
      equity: summary.equity.amount,
      cash: summary.cash.amount,
      positionsValue: summary.positionsValue.amount,
      cumulativeReturn: metrics.cumulativeReturn,
      maxDrawdown: metrics.maxDrawdown,
      sharpe: metrics.sharpe,
      winRate,
    };

    if (this.snapshots) {
      await this.snapshots.appendSnapshot(snapshot);
    }
    return snapshot;
  }

  /**
   * 戦略 vs ベンチのリターン比較（spec §2.7 P1「ベンチマーク比較」/ §9 公正性）。
   *
   * 公正性のための同条件保証:
   * - **基準点を一致させる**: 戦略リターンは range 内の実エクイティ点の最初→最後で測る。
   *   ベンチも *その同じ 2 点のタイムスタンプ* の価格で測る（nominal な range.from/to ではなく、
   *   実際にデータが存在する境界に揃える）。これで両者の評価期間がずれない。
   * - **ルックアヘッド禁止**: 価格取得は基準点の時刻まで。評価時点（range.to）以降の値は使わない。
   * - **手数料込み**: 戦略のエクイティは PortfolioService（約定・手数料反映後）由来。
   *
   * 比較が公正に成立しない場合は値を捏造せず {@link BenchmarkUnavailableError} を投げる。
   */
  async compare(
    accountId: string,
    benchmark: BenchmarkId,
    range: { from: Date; to: Date },
  ): Promise<BenchmarkComparison> {
    const instrumentId =
      benchmark === "BUY_AND_HOLD"
        ? this.benchmark.buyAndHoldInstrumentId
        : this.benchmark.indexInstrumentId?.[benchmark];
    if (!instrumentId) {
      throw new BenchmarkUnavailableError(
        benchmark,
        "NOT_CONFIGURED",
        `no benchmark instrument configured for ${benchmark}`,
      );
    }

    // 戦略リターン: range 内のエクイティ点の最初→最後（同条件・手数料込み）。
    const history = (await this.portfolio.getHistory(accountId, range))
      .slice()
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    if (history.length < 2) {
      // 同条件で測れる戦略エクイティ点が無い → 比較不能を明示（0 を捏造しない）。
      throw new BenchmarkUnavailableError(
        benchmark,
        "NO_STRATEGY_EQUITY",
        `not enough equity points in range to compare ${benchmark}`,
      );
    }
    const startPoint = history[0]!;
    const endPoint = history[history.length - 1]!;
    const strategyReturn = simpleReturn(
      new Decimal(startPoint.equity),
      new Decimal(endPoint.equity),
    );

    // ベンチリターン: 戦略と *同一の基準時刻* の価格から算出（同条件・ルックアヘッド禁止）。
    const startPx = await this.benchmarkPriceAt(
      benchmark,
      instrumentId,
      new Date(startPoint.ts),
    );
    const endPx = await this.benchmarkPriceAt(
      benchmark,
      instrumentId,
      new Date(endPoint.ts),
    );
    const benchmarkReturn = simpleReturn(startPx, endPx);

    return {
      accountId,
      benchmark,
      // 比較に実際に用いた基準点を返す（戦略・ベンチで一致）。
      range: { from: startPoint.ts, to: endPoint.ts },
      strategyReturn,
      benchmarkReturn,
      excessReturn: new Decimal(strategyReturn)
        .minus(benchmarkReturn)
        .toNumber(),
    };
  }

  /**
   * {@link compare} のラッパ。比較が公正に成立しないときに
   * {@link BenchmarkUnavailableError} を投げる代わりに、理由付きの
   * {@link BenchmarkComparisonResult}（discriminated union）を返す。
   *
   * - 成立: `{ available: true, comparison }`。
   * - 不成立: `{ available: false, benchmark, reason }`（値を捏造しない）。
   *
   * api はこれを使えば throw を握り潰さず、比較不能の理由を型付きで
   * クライアントへ提示できる（spec §2.7 P1 ベンチ比較 / §9 公正性）。
   * `BenchmarkUnavailableError` 以外の例外（インフラ障害等）は捕捉せず再送出する。
   */
  async compareResult(
    accountId: string,
    benchmark: BenchmarkId,
    range: { from: Date; to: Date },
  ): Promise<BenchmarkComparisonResult> {
    try {
      const comparison = await this.compare(accountId, benchmark, range);
      return { available: true, comparison };
    } catch (err) {
      if (err instanceof BenchmarkUnavailableError) {
        return { available: false, benchmark: err.benchmark, reason: err.reason };
      }
      throw err;
    }
  }

  /**
   * ベンチ銘柄の at 時点価格を取得する。データ欠落は推測せず
   * {@link BenchmarkUnavailableError} に倒す（公正性 §9）。
   */
  private async benchmarkPriceAt(
    benchmark: BenchmarkId,
    instrumentId: string,
    at: Date,
  ): Promise<Decimal> {
    try {
      const px = await this.price.getLatestPrice(instrumentId, at);
      return new Decimal(px.amount);
    } catch (err) {
      throw new BenchmarkUnavailableError(
        benchmark,
        "PRICE_DATA_MISSING",
        `no benchmark price for ${instrumentId} at ${at.toISOString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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

/** 基準値→終値の単純リターン。基準が 0 以下なら 0（ゼロ割回避）。 */
const simpleReturn = (first: Decimal, last: Decimal): number => {
  if (first.lte(ZERO)) return 0;
  return last.minus(first).dividedBy(first).toNumber();
};
