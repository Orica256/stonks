-- Phase 8: TaxLot に資金区分 marginType を追加（spec §5.1）。
-- CASH 現物と MARGIN 信用の税ロットを分離し、FIFO/LIFO で取り崩し順・原価が混ざるのを防ぐ。
-- 後方互換: DEFAULT 'CASH' 付き ADD COLUMN のため既存の税ロット行は CASH として保たれる。
-- enum MarginType は Phase 3（20260620_phase3_margin_tax）で作成済みのため CREATE TYPE は不要。
-- 注意: 本ファイルは手書き（プロジェクト方針: live DB が無い環境では生 SQL を migrations/ に追補）。
-- DATABASE_URL のある環境では `prisma migrate dev` で再生成しても等価になるよう保つこと。

ALTER TABLE "TaxLot" ADD COLUMN "marginType" "MarginType" NOT NULL DEFAULT 'CASH';
