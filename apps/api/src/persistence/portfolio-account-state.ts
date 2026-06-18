import type { Currency } from "@stonks/contracts";
import type { AccountStateProvider } from "@stonks/trading-engine";
import type { PortfolioRepository } from "@stonks/portfolio";

/**
 * trading-engine の AccountStateProvider（現金/保有の読み取り）を
 * portfolio の PortfolioRepository にブリッジする（契約ギャップの吸収点）。
 *
 * contracts には「現金/保有の読み取り IF」が無いため、ここで結線層が橋渡しする:
 * - getAvailableCash → PortfolioRepository.getCashBalance
 * - getPositionQuantity → PortfolioRepository.getPosition
 *
 * これにより in-memory / Prisma いずれの PortfolioRepository 実装でも
 * 同一ブリッジで trading-engine の事前チェック（現金/保有）が機能する。
 */
export class PortfolioAccountStateProvider implements AccountStateProvider {
  constructor(private readonly repo: PortfolioRepository) {}

  async getAvailableCash(accountId: string, currency: string): Promise<string> {
    const bal = await this.repo.getCashBalance(accountId, currency as Currency);
    return bal?.amount ?? "0";
  }

  async getPositionQuantity(
    accountId: string,
    instrumentId: string,
  ): Promise<number> {
    const pos = await this.repo.getPosition(accountId, instrumentId);
    return pos?.quantity ?? 0;
  }
}
