import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const g = globalThis as unknown as {
  __financeDb?: Db;
  __financeDbPath?: string;
};

export function dbPath(): string {
  return (
    process.env.FINANCE_DB ?? path.join(process.cwd(), "data", "finance.db")
  );
}

export function openDb(file: string): Db {
  if (file !== ":memory:")
    fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

export function getDb(): Db {
  const file = dbPath();
  if (!g.__financeDb || g.__financeDbPath !== file) {
    g.__financeDb = openDb(file);
    g.__financeDbPath = file;
  }
  return g.__financeDb;
}
