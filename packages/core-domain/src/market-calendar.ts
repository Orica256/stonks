import type { Market } from "@stonks/contracts";

/**
 * 市場カレンダー（取引時間・休場判定。spec §9 / CLAUDE.md §0）。
 * すべて UTC で判定する。祝日は Phase 1 で各国カレンダーを注入して拡張する想定で、
 * ここでは「曜日 + 現地レギュラーセッション時間」までを実装する。
 */

interface SessionHoursLocal {
  tz: string; // IANA タイムゾーン
  openMinutes: number; // 現地 00:00 からの分（場中開始）
  closeMinutes: number; // 場中終了
}

// レギュラーセッション（昼休みは簡易化のため通しで扱う。詳細化は Phase 1）。
const SESSIONS: Record<Market, SessionHoursLocal> = {
  JP: { tz: "Asia/Tokyo", openMinutes: 9 * 60, closeMinutes: 15 * 60 },
  US: {
    tz: "America/New_York",
    openMinutes: 9 * 60 + 30,
    closeMinutes: 16 * 60,
  },
};

/** 指定タイムゾーンでの「曜日(0=日)」と「00:00 からの分」を返す。 */
const localParts = (
  at: Date,
  tz: string,
): { weekday: number; minutes: number } => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[get("weekday")] ?? 0;
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return { weekday, minutes: hour * 60 + minute };
};

/** 平日かつレギュラーセッション内なら true（祝日は未考慮: Phase 1 で注入）。 */
export const isMarketOpen = (market: Market, at: Date): boolean => {
  const s = SESSIONS[market];
  const { weekday, minutes } = localParts(at, s.tz);
  const isWeekday = weekday >= 1 && weekday <= 5;
  return isWeekday && minutes >= s.openMinutes && minutes < s.closeMinutes;
};
