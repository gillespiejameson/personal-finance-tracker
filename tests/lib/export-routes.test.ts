import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureDefaultCategories,
  findCategoryId,
} from "@/lib/categories/ensure";
import { type Db, getDb, openDb } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";

/**
 * `openDb` returns the Drizzle wrapper, not the underlying `better-sqlite3`
 * handle it holds open — on Windows that handle keeps a lock on the file
 * until closed, and each test removes its temp directory afterward.
 */
function closeDb(db: Db): void {
  (db as unknown as { $client: Database.Database }).$client.close();
}

describe("export routes", () => {
  let dir: string;
  let dbFile: string;
  let originalFinanceDb: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pft-export-routes-"));
    dbFile = path.join(dir, "finance.db");
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
          date: "2026-08-05",
          amountCents: -1234,
          rawDescription: "KROGER #123",
          merchant: "Kroger",
          dedupeHash: "r1",
          categoryId: groceries,
        },
        {
          accountId: a.id,
          date: "2026-08-04",
          amountCents: -4000,
          rawDescription: "COSTCO",
          merchant: "Costco",
          dedupeHash: "r2",
        },
      ])
      .run();
    closeDb(db);
    originalFinanceDb = process.env.FINANCE_DB;
    process.env.FINANCE_DB = dbFile;
  });

  afterEach(() => {
    // The routes call `getDb()`, which caches a connection on `globalThis`
    // keyed by path — close it before restoring `FINANCE_DB`, or the open
    // handle blocks removing the temp dir on Windows (EPERM).
    closeDb(getDb());
    if (originalFinanceDb === undefined) delete process.env.FINANCE_DB;
    else process.env.FINANCE_DB = originalFinanceDb;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("GET /api/export/transactions", () => {
    it("returns a filtered CSV with the expected status, headers and first line", async () => {
      const { GET } = await import("@/app/api/export/transactions/route");
      const res = await GET(
        new Request(
          "http://localhost/api/export/transactions?from=2026-08-01&to=2026-08-31",
        ),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe(
        'attachment; filename="transactions-2026-08-01-2026-08-31.csv"',
      );
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.text();
      const lines = body.split("\r\n").filter(Boolean);
      expect(lines[0]).toBe(
        "date,account,merchant,description,amount,category_group,category,transfer,possible_duplicate,splits",
      );
      expect(lines).toHaveLength(3);
      expect(lines[1]).toBe(
        "2026-08-05,Chk,Kroger,KROGER #123,-12.34,Food,Groceries,no,no,",
      );
    });

    it("honors the group filter", async () => {
      const { GET } = await import("@/app/api/export/transactions/route");
      const food = findCategoryId(getDb(), "Food") as number;
      const res = await GET(
        new Request(`http://localhost/api/export/transactions?group=${food}`),
      );
      expect(res.status).toBe(200);
      const lines = (await res.text()).split("\r\n").filter(Boolean);
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain(",Food,Groceries,");
    });

    it("honors the account filter", async () => {
      const { GET } = await import("@/app/api/export/transactions/route");
      const res = await GET(
        new Request("http://localhost/api/export/transactions?account=999999"),
      );
      expect(res.status).toBe(200);
      const body = await res.text();
      const lines = body.split("\r\n").filter(Boolean);
      expect(lines).toHaveLength(1);
    });

    it("returns 400 for an invalid from date", async () => {
      const { GET } = await import("@/app/api/export/transactions/route");
      const res = await GET(
        new Request("http://localhost/api/export/transactions?from=2026-13-01"),
      );
      expect(res.status).toBe(400);
    });

    it("accepts a q longer than 80 characters, truncating rather than 400ing", async () => {
      const { GET } = await import("@/app/api/export/transactions/route");
      const q = "a".repeat(81);
      const res = await GET(
        new Request(
          `http://localhost/api/export/transactions?q=${encodeURIComponent(q)}`,
        ),
      );
      expect(res.status).toBe(200);
    });

    it("returns a 500 text/plain response when the CSV export throws", async () => {
      vi.resetModules();
      vi.doMock("@/lib/export/transactions", async (importOriginal) => {
        const actual =
          await importOriginal<typeof import("@/lib/export/transactions")>();
        return {
          ...actual,
          transactionsCsv: () => {
            throw new Error("boom");
          },
        };
      });
      try {
        const { GET } = await import("@/app/api/export/transactions/route");
        const res = await GET(
          new Request("http://localhost/api/export/transactions"),
        );
        expect(res.status).toBe(500);
        expect(res.headers.get("content-type")).toBe("text/plain");
        expect(await res.text()).toBe("Export failed: boom");
      } finally {
        vi.doUnmock("@/lib/export/transactions");
        vi.resetModules();
      }
    });
  });

  describe("GET /api/export/backup", () => {
    it("returns the copied database as an octet-stream download", async () => {
      const { GET } = await import("@/app/api/export/backup/route");
      const res = await GET();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("content-disposition")).toMatch(
        /^attachment; filename="finance-\d{8}-\d{6}\.db"$/,
      );
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.length).toBeGreaterThan(0);
    });

    it("returns a 500 response when the backup fails", async () => {
      vi.resetModules();
      vi.doMock("@/lib/db/backup", async (importOriginal) => {
        const actual = await importOriginal<typeof import("@/lib/db/backup")>();
        return {
          ...actual,
          backupDb: () => {
            throw new Error("disk full");
          },
        };
      });
      try {
        const { GET } = await import("@/app/api/export/backup/route");
        const res = await GET();
        expect(res.status).toBe(500);
        expect(await res.text()).toBe("Backup failed: disk full");
      } finally {
        vi.doUnmock("@/lib/db/backup");
        vi.resetModules();
      }
    });
  });
});
