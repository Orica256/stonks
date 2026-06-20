/**
 * クライアント側で参照する公開設定。
 * API ベース URL は env で差し替え可能（完全ローカル運用。CLAUDE.md §0）。
 * 秘密情報は一切クライアントに載せない（CLAUDE.md §7）。
 */

/** apps/api のベース URL。既定はローカルの NestJS（spec §6.8, port 3001）。 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

/**
 * 既定の口座 ID。単一ローカルユーザ前提（spec §2.6）。
 * 複数口座（人間/エージェント）対応は後続スライスで口座セレクタ化する。
 */
export const DEFAULT_ACCOUNT_ID =
  process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID ?? "default";
