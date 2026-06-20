import type { AccountStateProvider, Currency } from "@stonks/contracts";
import type { PortfolioRepository } from "./repository.js";

/**
 * contracts の AccountStateProvider（現金/保有の読み取り IF・B2）を
 * PortfolioRepository 上に実装する。
 *
 * trading-engine の発注前チェック（現金/保有）が PortfolioService 全体に依存せず、
 * この最小読み取りポートだけで機能する。in-memory / Prisma いずれの
 * PortfolioRepository 実装でも同一の振る舞いになる。
 */
export class RepositoryAccountStateProvider implements AccountStateProvider {
  constructor(private readonly repo: PortfolioRepository) {}

  async getAvailableCash(accountId: string, currency: Currency): Promise<string> {
    const bal = await this.repo.getCashBalance(accountId, currency);
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
