import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { backupDb } from "@/lib/db/backup";
import { type Db, openDb } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";

/**
 * `openDb` returns the Drizzle wrapper, not the underlying `better-sqlite3`
 * handle it holds open — but on Windows that handle keeps a lock on the file
 * until closed, and this test removes its temp directory when it's done.
 */
function closeDb(db: Db): void {
  (db as unknown as { $client: Database.Database }).$client.close();
}

describe("backupDb (export reuse)", () => {
  it("copies a seeded database to a named file with a matching transaction count", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pft-backup-"));
    try {
      const dbFile = path.join(dir, "finance.db");
      const db = openDb(dbFile);
      ensureDefaultCategories(db);
      const [a] = db
        .insert(accounts)
        .values({ name: "Chk", type: "checking" })
        .returning()
        .all();
      const groceries = findCategoryId(db, "Groceries") as number;
      db.insert(transactions)
        .values([
          {
            accountId: a.id,
            date: "2026-03-01",
            amountCents: -1000,
            rawDescription: "A",
            merchant: "A",
            dedupeHash: "bk1",
            categoryId: groceries,
          },
          {
            accountId: a.id,
            date: "2026-03-02",
            amountCents: -2000,
            rawDescription: "B",
            merchant: "B",
            dedupeHash: "bk2",
          },
        ])
        .run();

      const backupsDir = path.join(dir, "backups");
      const dest = backupDb(dbFile, backupsDir);
      closeDb(db);

      expect(path.dirname(dest)).toBe(backupsDir);
      expect(path.basename(dest)).toMatch(/^finance-\d{8}-\d{6}\.db$/);

      const copy = openDb(dest);
      expect(copy.select().from(transactions).all()).toHaveLength(2);
      closeDb(copy);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
