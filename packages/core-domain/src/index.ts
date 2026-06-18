/**
 * @stonks/core-domain — 純粋ドメインロジック（値演算・ルール）。
 * DB/ネットワーク非依存。各ドメインパッケージが依存する基盤（CLAUDE.md §0）。
 */
export * as Money from "./money.js";
export * from "./tick.js";
export * from "./market-calendar.js";
