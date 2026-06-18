# @stonks/db

Prisma スキーマ・マイグレーション・クライアント（spec §5 のデータモデル）。

## 提供物
- `prisma/schema.prisma` — 全エンティティ（Instrument/PriceBar/Quote/Account/Order/Trade/Ledger/AgentProfile/AgentDecision 等）。
- `getPrisma()` — プロセス共有の `PrismaClient`。`@prisma/client` の型を re-export。

## メモ
- 金額は `Decimal`、時刻は `DateTime`(UTC)。`PriceBar` は複合主キー `(instrumentId, timeframe, ts)`。
- `PriceBar` は将来 **TimescaleDB hypertable** 化する（Prisma 管理外の生 SQL を migration に追補）。
- `Timeframe` enum は Prisma 識別子制約のため `m1/m5/m15/h1/d1`（contracts の `1m` 等とアダプタ層で対応付け）。

## コマンド
```
docker compose up -d db                 # Postgres(TimescaleDB) 起動
pnpm --filter @stonks/db generate       # クライアント生成
pnpm --filter @stonks/db migrate        # マイグレーション（要 DATABASE_URL）
```
