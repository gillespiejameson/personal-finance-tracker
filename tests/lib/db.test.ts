import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { backupDb } from "@/lib/db/backup";
import { openDb } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";

describe("db", () => {
  it("migrates in memory and inserts an account", () => {
    const db = openDb(":memory:");
    db.insert(accounts)
      .values({ name: "Chase Checking", type: "checking" })
      .run();
    expect(db.select().from(accounts).all()).toHaveLength(1);
  });

  it("backup copies and prunes to 20", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fin-"));
    const file = path.join(dir, "finance.db");
    new Database(file).close();
    const backups = path.join(dir, "backups");
    fs.mkdirSync(backups, { recursive: true });
    for (let i = 0; i < 22; i++) {
      fs.writeFileSync(
        path.join(
          backups,
          `finance-20260101-${String(1000000 + i).slice(1)}.db`,
        ),
        "old",
      );
    }
    const dest = backupDb(file, backups);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readdirSync(backups)).toHaveLength(20);
  });

  it("backup includes rows still in the WAL", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fin-wal-"));
    const file = path.join(dir, "finance.db");
    const db = openDb(file);
    db.insert(accounts).values({ name: "Live", type: "checking" }).run();
    // connection still open, WAL not checkpointed
    const dest = backupDb(file, path.join(dir, "backups"));
    const copy = openDb(dest);
    expect(copy.select().from(accounts).all()).toHaveLength(1);
  });
});
