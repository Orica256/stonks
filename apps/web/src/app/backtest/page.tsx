import { BacktestView } from "@/features/backtest/backtest-view";

/**
 * バックテスト画面（spec §2.5）。戦略プリセット・期間・初期資金を指定して
 * `POST /backtests` を実行し、成績指標とエクイティカーブを表示する。
 */
export default function BacktestPage(): JSX.Element {
  return <BacktestView />;
}
