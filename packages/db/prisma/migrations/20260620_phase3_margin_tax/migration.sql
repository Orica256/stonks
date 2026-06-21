-- Phase 3: 信用取引（margin）・税ロット（tax lot）の追加（spec §2.2/§2.3 P2, §5.1）。
-- すべて後方互換: 既存列は DEFAULT 付きで追加し、既存の現物フローを壊さない。
-- 注意: 本ファイルは手書き（プロジェクト方針: live DB が無い環境では生 SQL を migrations/ に追補）。
-- DATABASE_URL のある環境では `prisma migrate dev` で再生成しても等価になるよう保つこと。

-- ── 新規 enum ──
CREATE TYPE "MarginType" AS ENUM ('CASH', 'MARGIN');
CREATE TYPE "CostBasisMethod" AS ENUM ('AVERAGE', 'FIFO', 'LIFO', 'SPECIFIC_LOT');
CREATE TYPE "TaxAccountType" AS ENUM ('SPECIFIC', 'GENERAL', 'NISA');
CREATE TYPE "InterestAccrualType" AS ENUM ('INTEREST', 'BORROW_FEE');

-- ── LedgerEntryType に金利/貸株料を追加 ──
ALTER TYPE "LedgerEntryType" ADD VALUE 'INTEREST';
ALTER TYPE "LedgerEntryType" ADD VALUE 'BORROW_FEE';

-- ── Order: 資金区分 ──
ALTER TABLE "Order" ADD COLUMN "marginType" "MarginType" NOT NULL DEFAULT 'CASH';

-- ── Trade: 資金区分 ──
ALTER TABLE "Trade" ADD COLUMN "marginType" "MarginType" NOT NULL DEFAULT 'CASH';

-- ── Position: 信用拡張（現物は既定/NULL で従来挙動を維持） ──
ALTER TABLE "Position" ADD COLUMN "marginType" "MarginType" NOT NULL DEFAULT 'CASH';
ALTER TABLE "Position" ADD COLUMN "postedMargin" DECIMAL(65,30);
ALTER TABLE "Position" ADD COLUMN "initialMarginRate" DECIMAL(65,30);
ALTER TABLE "Position" ADD COLUMN "maintenanceMarginRate" DECIMAL(65,30);
ALTER TABLE "Position" ADD COLUMN "annualRate" DECIMAL(65,30);
ALTER TABLE "Position" ADD COLUMN "accruedInterest" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Position" ADD COLUMN "lastAccruedAt" TIMESTAMP(3);
-- Position の一意キーは [accountId, instrumentId, side] のまま据え置く（後方互換）。

-- ── TaxLot ──
CREATE TABLE "TaxLot" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "instrumentId" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "remainingQuantity" DOUBLE PRECISION NOT NULL,
  "costBasis" DECIMAL(65,30) NOT NULL,
  "currency" "Currency" NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "method" "CostBasisMethod" NOT NULL DEFAULT 'AVERAGE',
  "taxAccountType" "TaxAccountType" NOT NULL DEFAULT 'SPECIFIC',
  "acquiredTradeId" TEXT,
  CONSTRAINT "TaxLot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaxLot_accountId_instrumentId_acquiredAt_idx"
  ON "TaxLot" ("accountId", "instrumentId", "acquiredAt");
ALTER TABLE "TaxLot"
  ADD CONSTRAINT "TaxLot_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxLot"
  ADD CONSTRAINT "TaxLot_instrumentId_fkey"
  FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── InterestAccrual ──
CREATE TABLE "InterestAccrual" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "instrumentId" TEXT NOT NULL,
  "type" "InterestAccrualType" NOT NULL,
  "principal" DECIMAL(65,30) NOT NULL,
  "annualRate" DECIMAL(65,30) NOT NULL,
  "days" INTEGER NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "currency" "Currency" NOT NULL,
  "accruedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InterestAccrual_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InterestAccrual_accountId_accruedAt_idx"
  ON "InterestAccrual" ("accountId", "accruedAt");
CREATE INDEX "InterestAccrual_positionId_accruedAt_idx"
  ON "InterestAccrual" ("positionId", "accruedAt");
ALTER TABLE "InterestAccrual"
  ADD CONSTRAINT "InterestAccrual_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterestAccrual"
  ADD CONSTRAINT "InterestAccrual_instrumentId_fkey"
  FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
