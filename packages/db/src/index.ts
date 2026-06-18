/**
 * @stonks/db — Prisma クライアントと型の単一エクスポート点。
 * 各リポジトリ実装はここから PrismaClient を取得する。
 */
import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

let client: PrismaClient | undefined;

/** プロセス内で 1 つの PrismaClient を共有する。 */
export const getPrisma = (): PrismaClient => {
  client ??= new PrismaClient();
  return client;
};
