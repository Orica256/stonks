import type { StrategyDef, StrategyRule, Timeframe } from "@stonks/contracts";

/**
 * バックテスト画面のための戦略プリセット（spec §2.5）。
 *
 * 戦略入力は最小限に留める。ユーザは数個のプリセットから 1 つ選ぶだけで、
 * 対象銘柄・期間・初期資金とともに contracts の {@link StrategyDef} を組み立てる。
 * `when` 式は backtest 側の評価器がサポートする構文のみを使う
 * （`SMA(n) crossUp SMA(m)` / `price < N` / `always`）。手書き型は使わない。
 */

/** プリセットの識別子。 */
export type StrategyPresetId =
  | "sma-cross"
  | "sma-cross-fast"
  | "buy-and-hold";

/** UI に並べる 1 プリセットの定義。 */
export interface StrategyPreset {
  id: StrategyPresetId;
  /** 表示名。 */
  label: string;
  /** 戦略の概要（投資助言ではなくルールの説明）。 */
  description: string;
  /**
   * 対象銘柄・時間足を受け取り contracts の StrategyDef を生成する。
   * `universe`・`timeframe` は呼び出し側（フォーム）の選択を反映する。
   */
  build: (params: { universe: string[]; timeframe: Timeframe }) => StrategyDef;
}

/** 資産比率サイジング（プリセット共通で全力 1 銘柄を想定した簡易設定）。 */
const fullEquity: StrategyRule["sizing"] = {
  mode: "EQUITY_PCT",
  value: 1,
};

/**
 * 利用可能なプリセット一覧。順序は UI の表示順。
 * いずれも公開済みの `when` 構文のみを用いる（未対応式でランナーが投げないように）。
 */
export const STRATEGY_PRESETS: readonly StrategyPreset[] = [
  {
    id: "sma-cross",
    label: "SMA ゴールデン/デッドクロス (20/50)",
    description:
      "短期 SMA(20) が長期 SMA(50) を上抜けで買い、下抜けで手仕舞いする標準的な移動平均クロス。",
    build: ({ universe, timeframe }) => ({
      name: "SMA Cross 20/50",
      universe,
      timeframe,
      indicators: [
        { kind: "SMA", params: { period: 20 } },
        { kind: "SMA", params: { period: 50 } },
      ],
      rules: [
        {
          when: "SMA(20) crossUp SMA(50)",
          action: "BUY",
          sizing: fullEquity,
        },
        {
          when: "SMA(20) crossDown SMA(50)",
          action: "CLOSE",
          sizing: fullEquity,
        },
      ],
    }),
  },
  {
    id: "sma-cross-fast",
    label: "SMA 短期クロス (5/20)",
    description:
      "より反応の速い SMA(5)/SMA(20) のクロス。シグナルは増えるがダマシも増えやすい設定。",
    build: ({ universe, timeframe }) => ({
      name: "SMA Cross 5/20",
      universe,
      timeframe,
      indicators: [
        { kind: "SMA", params: { period: 5 } },
        { kind: "SMA", params: { period: 20 } },
      ],
      rules: [
        {
          when: "SMA(5) crossUp SMA(20)",
          action: "BUY",
          sizing: fullEquity,
        },
        {
          when: "SMA(5) crossDown SMA(20)",
          action: "CLOSE",
          sizing: fullEquity,
        },
      ],
    }),
  },
  {
    id: "buy-and-hold",
    label: "バイ・アンド・ホールド",
    description:
      "初日に建玉し、期間を通して保有し続ける基準戦略。クロス戦略の比較対象として使う。",
    build: ({ universe, timeframe }) => ({
      name: "Buy & Hold",
      universe,
      timeframe,
      indicators: [],
      rules: [
        {
          when: "always",
          action: "BUY",
          sizing: fullEquity,
        },
      ],
    }),
  },
] as const;

/** id からプリセットを引く（未知 id は undefined）。 */
export function findPreset(
  id: string,
): StrategyPreset | undefined {
  return STRATEGY_PRESETS.find((p) => p.id === id);
}
