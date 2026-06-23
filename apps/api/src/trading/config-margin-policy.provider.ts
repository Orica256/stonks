import { Inject, Injectable } from "@nestjs/common";
import type { MarginPolicy, MarginPolicyProvider } from "@stonks/contracts";
import { TOKENS } from "../common/tokens.js";
import type { AppConfig } from "../common/config.js";

/**
 * 設定（config / env）由来の `MarginPolicyProvider` 具象実装（Phase 6 B。spec §2.2 P2）。
 *
 * trading-engine は銘柄ごとの必要保証金率・金利を本ポートで解決する。本実装は
 * 全銘柄一律の既定ポリシー（`AppConfig.marginPolicy`）を返す最小実装で、信用不可銘柄
 * （`AppConfig.marginDisallowedInstruments` に含まれる id）は **null** を返す。
 *
 * 重要: `getMarginPolicy` が null を返すと、trading-engine 側で当該銘柄の MARGIN 発注は
 * 「信用不可」として拒否される（現物 CASH は影響を受けない）。本プロバイダ自体が未配線
 * （未注入）の場合も MARGIN は一律拒否されるため、MARGIN を受理するには本実装の DI 配線が必要。
 */
@Injectable()
export class ConfigMarginPolicyProvider implements MarginPolicyProvider {
  private readonly policy: MarginPolicy;
  private readonly disallowed: ReadonlySet<string>;

  constructor(@Inject(TOKENS.AppConfig) config: AppConfig) {
    this.policy = config.marginPolicy;
    this.disallowed = config.marginDisallowedInstruments;
  }

  /**
   * 銘柄の信用ポリシーを返す。信用不可リストに含まれる銘柄は null（→ MARGIN 発注拒否）。
   * それ以外は config の一律既定ポリシーを返す。
   */
  async getMarginPolicy(instrumentId: string): Promise<MarginPolicy | null> {
    if (this.disallowed.has(instrumentId)) return null;
    return this.policy;
  }
}
