/**
 * @stonks/portfolio — 保有・現金・損益の整合維持と評価（spec §2.3 / §5.1-§5.2 / §6.3）。
 *
 * 公開契約は @stonks/contracts の PortfolioService に厳密準拠。
 * 価格・為替は PriceProvider / FxProvider IF 経由でのみ取得し、
 * market-data や db を直接 import しない（依存性逆転・CLAUDE.md §0/§4.3）。
 */
export { DefaultPortfolioService } from "./portfolio-service.js";
export type {
  IdFactory,
  PortfolioServiceDeps,
} from "./portfolio-service.js";
export { InMemoryPortfolioRepository } from "./in-memory-repository.js";
export { RepositoryAccountStateProvider } from "./account-state-provider.js";
export type {
  PortfolioReadModel,
  PortfolioRepository,
} from "./repository.js";
