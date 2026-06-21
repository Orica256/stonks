# @stonks/db

Prisma スキーマ・マイグレーション・クライアント（spec §5 のデータモデル）。

## 提供物
- `prisma/schema.prisma` — 全エンティティ（Instrument/PriceBar/Quote/Account/Order/Trade/Ledger/AgentProfile/AgentDecision 等）。
- `getPrisma()` — プロセス共有の `PrismaClient`。`@prisma/client` の型を re-export。

## メモ
- `Instrument.id` は正準形式 `EXCHANGE:SYMBOL`（contracts `InstrumentId` / B1）。cuid 既定は使わず、
  market-data / apps/api と同一キーを共有する。
- `Position.currency` は建玉の取引通貨（B3。自己記述的に保持）。
- **Phase 3 信用/税ロット**（後方互換。すべて DEFAULT 付き追加）:
  - `Order.marginType` / `Trade.marginType` / `Position.marginType`（`@default(CASH)`。現物=CASH）。
  - `Position` に信用列（`postedMargin?` / `initialMarginRate?` / `maintenanceMarginRate?` /
    `annualRate?` / `accruedInterest @default(0)` / `lastAccruedAt?`）。
  - `TaxLot`（税ロット。`remainingQuantity` を売却で取り崩す。`method` / `taxAccountType`）。
  - `InterestAccrual`（信用建玉の金利/貸株料の発生記録）。
  - `LedgerEntryType` に `INTEREST` / `BORROW_FEE`。
  - 手書き SQL: `prisma/migrations/20260620_phase3_margin_tax/migration.sql`。
  - `Position` の一意キーは後方互換のため `[accountId, instrumentId, side]` のまま据え置き。
- 金額は `Decimal`、時刻は `DateTime`(UTC)。`PriceBar` は複合主キー `(instrumentId, timeframe, ts)`。
- `PriceBar` は将来 **TimescaleDB hypertable** 化する（Prisma 管理外の生 SQL を migration に追補）。
- `Timeframe` enum は Prisma 識別子制約のため `m1/m5/m15/h1/d1`（contracts の `1m` 等とアダプタ層で対応付け）。

## コマンド
```
docker compose up -d db                 # Postgres(TimescaleDB) 起動
pnpm --filter @stonks/db generate       # クライアント生成
pnpm --filter @stonks/db migrate        # マイグレーション（要 DATABASE_URL）
```
