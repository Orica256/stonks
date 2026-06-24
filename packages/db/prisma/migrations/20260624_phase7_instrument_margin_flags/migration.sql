-- Phase 7: Instrument に信用可否（貸借区分）フラグを追加（spec §5.1）。
-- 後方互換: 新規列はいずれも NULL 許容・既定値なしで追加し、既存の銘柄マスタ行を壊さない。
-- 注意: 本ファイルは手書き（プロジェクト方針: live DB が無い環境では生 SQL を migrations/ に追補）。
-- DATABASE_URL のある環境では `prisma migrate dev` で再生成しても等価になるよう保つこと。

-- ── Instrument: 信用可否フラグ（NULL=不明） ──
ALTER TABLE "Instrument" ADD COLUMN "marginTradable" BOOLEAN;
ALTER TABLE "Instrument" ADD COLUMN "shortMarginable" BOOLEAN;
