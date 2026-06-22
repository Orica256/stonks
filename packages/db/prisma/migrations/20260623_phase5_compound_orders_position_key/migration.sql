-- Phase 5: 複合注文（OCO/IFD/bracket）・建玉一意キー分離（spec §2.2 P2, §5.1）。
-- すべて後方互換: 新規列は DEFAULT 付き / NULL 許容で追加し、既存の現物・信用フローを壊さない。
-- 注意: 本ファイルは手書き（プロジェクト方針: live DB が無い環境では生 SQL を migrations/ に追補）。
-- DATABASE_URL のある環境では `prisma migrate dev` で再生成しても等価になるよう保つこと。

-- ── 新規 enum（複合注文） ──
CREATE TYPE "OrderLinkType" AS ENUM ('OCO', 'IFD');
CREATE TYPE "OrderActivation" AS ENUM ('ACTIVE', 'WAITING');

-- ── Order: 複合注文の link 列（単発は NULL/ACTIVE のまま従来挙動） ──
ALTER TABLE "Order" ADD COLUMN "linkGroupId" TEXT;
ALTER TABLE "Order" ADD COLUMN "linkType" "OrderLinkType";
ALTER TABLE "Order" ADD COLUMN "parentOrderId" TEXT;
ALTER TABLE "Order" ADD COLUMN "activation" "OrderActivation" NOT NULL DEFAULT 'ACTIVE';
CREATE INDEX "Order_linkGroupId_idx" ON "Order" ("linkGroupId");
CREATE INDEX "Order_parentOrderId_idx" ON "Order" ("parentOrderId");

-- ── Position: 一意キーを marginType 込みへ拡張（CASH/MARGIN 同方向建玉を分離） ──
-- 既存行は marginType=CASH（Phase 3 で DEFAULT 'CASH' 付与済み）のため、新キーでも一意性は保たれる。
-- 旧一意制約 [accountId, instrumentId, side] を落とし、[..., marginType] を張り直す。
ALTER TABLE "Position" DROP CONSTRAINT IF EXISTS "Position_accountId_instrumentId_side_key";
DROP INDEX IF EXISTS "Position_accountId_instrumentId_side_key";
ALTER TABLE "Position"
  ADD CONSTRAINT "Position_accountId_instrumentId_side_marginType_key"
  UNIQUE ("accountId", "instrumentId", "side", "marginType");
