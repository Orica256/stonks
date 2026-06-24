import type { Instrument, InstrumentId } from "@stonks/contracts";

/**
 * 信用建ての制度上可否（貸借区分）の正規化（spec §2.2 信用取引 / §5.1 Instrument 拡張）。
 *
 * 無料 API（Finnhub / Yahoo / J-Quants）は銘柄ごとの貸借区分（制度信用・貸借銘柄か）を
 * 一般に提供しない。ここで「捏造」はせず、シミュレーションとして妥当な既定を
 * **明示的なルール＋設定で上書き可能なマップ**として与える。
 *
 * 二つのフラグはいずれも contracts の `Instrument` の任意フィールドで、
 * `undefined` = 不明（＝事前抑止しない／上位レイヤの判断に委ねる）を意味する。
 * `false`（=制度上不可）と `undefined`（=不明）は明確に区別し、判断不能なら `false` を
 * 勝手に入れない。
 *
 * - `marginTradable`  : 信用買建（制度/一般信用での新規買建）が制度上可能か。
 * - `shortMarginable` : 信用売建（空売り＝貸借銘柄）が制度上可能か。
 *
 * 解決の優先順位（先勝ち）:
 *   1. override マップの明示指定（instrumentId 単位、フラグ単位で最優先）
 *   2. ルールベース既定（取引所・銘柄種別から導出）
 *   3. どちらでも決まらなければ `undefined`（不明）
 */
export type MarginEligibility = {
  marginTradable?: boolean;
  shortMarginable?: boolean;
};

/** instrumentId 単位の上書き指定（フラグ単位で部分指定可）。 */
export type MarginEligibilityOverride = MarginEligibility;

export interface MarginEligibilityOptions {
  /**
   * instrumentId(`EXCHANGE:SYMBOL`) → 明示フラグのマップ。最優先。
   * 値で `marginTradable` / `shortMarginable` を個別に true/false 指定できる。
   * 指定しなかったフラグはルール既定に委ねられる。
   */
  overrides?: Record<string, MarginEligibilityOverride>;
}

/**
 * ルールベース既定（spec §2.2）。
 *
 * 根拠と安全側設計:
 * - 主要取引所（TSE / NYSE / NASDAQ）上場の STOCK / ETF は、シミュレーション上
 *   一般に信用買建の対象になり得るため `marginTradable=true` を既定とする。
 *   （現物専業の特殊銘柄等は override で `false` 指定する想定。）
 * - 空売り（`shortMarginable`）は市場差が大きい:
 *     - US 株/ETF は概ね空売り可能なため `true` を既定とする。
 *     - JP は貸借銘柄に限られ、無料 API からは個別判定できない。捏造を避けるため
 *       **安全側で `undefined`（不明＝抑止しない）** とし、貸借銘柄かどうかは
 *       override で個別に true/false 指定する運用とする。
 *
 * いずれもあくまで「明示的な既定ルール」であり、銘柄マスタ由来の確定情報ではない。
 */
const ruleBasedDefault = (instrument: {
  market: Instrument["market"];
  type: Instrument["type"];
}): MarginEligibility => {
  const isStockLike = instrument.type === "STOCK" || instrument.type === "ETF";
  if (!isStockLike) return {};

  if (instrument.market === "US") {
    // US 株/ETF: 信用買建・空売りともに概ね可能。
    return { marginTradable: true, shortMarginable: true };
  }
  // JP 株/ETF: 信用買建は既定 true。空売り（貸借銘柄）は個別判定不能のため不明。
  return { marginTradable: true };
};

/**
 * 銘柄の信用建て可否（貸借区分上の既定）を解決する純関数。
 *
 * override（明示設定）を最優先し、無ければルール既定、それでも決まらなければ
 * `undefined`（不明）を返す。フラグ単位で解決するため、override で片方だけ
 * 指定し他方はルール既定、という併用も可能。
 *
 * @param instrument 解決対象（id・market・type を参照）。
 * @param options    override マップ等。
 * @returns 設定された側のフラグのみを持つオブジェクト（不明な側はキー自体を省く）。
 */
export const resolveMarginEligibility = (
  instrument: {
    id: InstrumentId;
    market: Instrument["market"];
    type: Instrument["type"];
  },
  options: MarginEligibilityOptions = {},
): MarginEligibility => {
  const override = options.overrides?.[instrument.id] ?? {};
  const rule = ruleBasedDefault(instrument);

  const result: MarginEligibility = {};
  // 明示設定（override）→ ルール既定 → 省略（undefined）の順で先勝ち。
  const margin = override.marginTradable ?? rule.marginTradable;
  if (margin !== undefined) result.marginTradable = margin;
  const short = override.shortMarginable ?? rule.shortMarginable;
  if (short !== undefined) result.shortMarginable = short;
  return result;
};

/**
 * 環境変数からオーバーライドマップを読む。
 *
 * 既存の env 流儀（`MARGIN_DISALLOWED_INSTRUMENTS` 等のカンマ区切り）に倣い、
 * カンマ区切りのトークン列で指定する。各トークンは `INSTRUMENT_ID[:FLAGS]` の形式:
 *   - `MARGIN_TRADABLE_OVERRIDES`  : `marginTradable` の上書き
 *   - `SHORT_MARGINABLE_OVERRIDES` : `shortMarginable` の上書き
 *
 * FLAGS は `+`/`true`/`1`/`yes` = true、`-`/`false`/`0`/`no` = false。
 * FLAGS 省略時は true（許可リストとして使う想定）。instrumentId は `EXCHANGE:SYMBOL`
 * のため `:` を含む。値側の `:` は最後の区切りのみをフラグとみなす。
 *
 * 例:
 *   MARGIN_TRADABLE_OVERRIDES="TSE:9984,TSE:1234:false"
 *   SHORT_MARGINABLE_OVERRIDES="TSE:7203:true,TSE:1234:false"
 */
export const parseMarginEligibilityEnv = (
  env: Record<string, string | undefined> = process.env,
): MarginEligibilityOptions => {
  const overrides: Record<string, MarginEligibilityOverride> = {};
  applyOverrideEnv(env.MARGIN_TRADABLE_OVERRIDES, "marginTradable", overrides);
  applyOverrideEnv(
    env.SHORT_MARGINABLE_OVERRIDES,
    "shortMarginable",
    overrides,
  );
  return Object.keys(overrides).length > 0 ? { overrides } : {};
};

const TRUE_TOKENS = new Set(["+", "true", "1", "yes", "y"]);
const FALSE_TOKENS = new Set(["-", "false", "0", "no", "n"]);

/** 単一フラグの env を解析し overrides に畳み込む。 */
const applyOverrideEnv = (
  raw: string | undefined,
  flag: keyof MarginEligibility,
  overrides: Record<string, MarginEligibilityOverride>,
): void => {
  if (!raw) return;
  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const { id, value } = parseOverrideToken(trimmed);
    if (id === undefined || value === undefined) continue;
    const existing = overrides[id] ?? (overrides[id] = {});
    existing[flag] = value;
  }
};

/** `EXCHANGE:SYMBOL[:FLAG]` を id と真偽に分解する。不正なら id/value=undefined。 */
const parseOverrideToken = (
  token: string,
): { id?: string; value?: boolean } => {
  const lastColon = token.lastIndexOf(":");
  // instrumentId 自体が `EXCHANGE:SYMBOL`（コロン 1 つ）を含むため、
  // コロンが 2 つ以上ある場合のみ末尾をフラグとみなす。
  const colonCount = (token.match(/:/g) ?? []).length;
  if (colonCount >= 2) {
    const id = token.slice(0, lastColon);
    const flagStr = token.slice(lastColon + 1).toLowerCase();
    const value = parseBoolToken(flagStr);
    if (value === undefined) return {};
    return { id, value };
  }
  // フラグ省略 = true（許可リスト運用）。
  return { id: token, value: true };
};

const parseBoolToken = (s: string): boolean | undefined => {
  if (TRUE_TOKENS.has(s)) return true;
  if (FALSE_TOKENS.has(s)) return false;
  return undefined;
};
