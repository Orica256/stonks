import { Body, Controller, Inject, Post } from "@nestjs/common";
import {
  type BacktestResult,
  RunBacktestRequest,
} from "@stonks/contracts";
import { TOKENS } from "../common/tokens.js";
import type { MarketDataBacktestRunnerFactory } from "./market-data-source.js";

/**
 * バックテスト REST エンドポイント（spec §6.5 / §6.8）:
 *   POST /backtests   StrategyDef + range + initialCash を受け BacktestResult を返す
 *
 * 入力は contracts.RunBacktestRequest を唯一の真実として検証（手書き型と二重管理しない）。
 * 実行はファクトリへ委譲し、market-data からヒストリカルバーを供給して
 * trading-engine の約定ロジック・analytics の指標を再利用する（spec §4.3）。
 * 金額は Decimal 文字列で受け渡し、損益指標は backtest 側で Money/Decimal 経由に保つ。
 */
@Controller()
export class BacktestController {
  constructor(
    @Inject(TOKENS.BacktestRunnerFactory)
    private readonly factory: MarketDataBacktestRunnerFactory,
  ) {}

  @Post("backtests")
  async run(@Body() body: unknown): Promise<BacktestResult> {
    const req = RunBacktestRequest.parse(body);
    return this.factory.run(req);
  }
}
