import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { accounts, bankProfiles, transactions } from "@/lib/db/schema";
import { type CommitFlowDeps, runCommitFlow } from "@/lib/import/commitFlow";
import { BUILTIN_PROFILES } from "@/lib/import/profiles";

/** A file whose header signature matches the builtin "Chase (card)" profile. */
const CHASE_CSV = [
  "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
  "03/01/2026,03/02/2026,KROGER #1234,Groceries,Sale,-23.45,",
  "03/03/2026,03/03/2026,SHELL OIL,Gas,Sale,-40.00,",
].join("\n");

/** A file no builtin recognizes, so a wizard mapping has to be supplied. */
const CUSTOM_CSV = ["When,What,Amt", "2026-03-01,TESCO,-12.50"].join("\n");
const CUSTOM_OVERRIDE = {
  dateCol: "When",
  descCol: "What",
  amountCol: "Amt",
  dateFormat: "YMD" as const,
  signConvention: "outflow_negative" as const,
};

function setup() {
  const db = openDb(":memory:");
  const [acct] = db
    .insert(accounts)
    .values({ name: "Card", type: "credit" })
    .returning()
    .all();
  const deps: CommitFlowDeps = {
    backup: () => "data/backups/finance-20260305-120000.db",
    builtins: BUILTIN_PROFILES,
  };
  return { db, acct, deps };
}

describe("runCommitFlow", () => {
  it("cancels the import when the backup fails for a real reason", () => {
    const { db, acct, deps } = setup();
    const res = runCommitFlow(
      db,
      {
        ...deps,
        backup: () => {
          throw new Error("disk full");
        },
      },
      { accountId: acct.id, filename: "chase.csv", text: CHASE_CSV },
    );
    expect(res).toEqual({
      ok: false,
      error: "Backup failed, import cancelled: disk full",
    });
    expect(db.select().from(transactions).all()).toHaveLength(0);
  });

  it("imports anyway when there is no database file to back up yet", () => {
    const { db, acct, deps } = setup();
    const res = runCommitFlow(
      db,
      {
        ...deps,
        backup: () => {
          throw Object.assign(new Error("x"), { code: "ENOENT" });
        },
      },
      { accountId: acct.id, filename: "chase.csv", text: CHASE_CSV },
    );
    expect(res).toMatchObject({ ok: true, newCount: 2 });
    expect(db.select().from(transactions).all()).toHaveLength(2);
  });

  it("rejects the same file a second time", () => {
    const { db, acct, deps } = setup();
    const args = {
      accountId: acct.id,
      filename: "chase.csv",
      text: CHASE_CSV,
    };
    expect(runCommitFlow(db, deps, args)).toMatchObject({ ok: true });
    const again = runCommitFlow(db, deps, { ...args, filename: "copy.csv" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already imported/);
  });

  it("saves a wizard profile once, and never for a builtin signature", () => {
    const { db, acct, deps } = setup();
    expect(
      runCommitFlow(db, deps, {
        accountId: acct.id,
        filename: "credit-union.csv",
        text: CUSTOM_CSV,
        override: CUSTOM_OVERRIDE,
        saveProfileAs: "My Credit Union",
      }),
    ).toMatchObject({ ok: true, newCount: 1 });
    expect(
      db
        .select()
        .from(bankProfiles)
        .all()
        .map((p) => p.name),
    ).toEqual(["My Credit Union"]);

    // A builtin-signature file must not shadow the builtin with a saved row.
    expect(
      runCommitFlow(db, deps, {
        accountId: acct.id,
        filename: "chase.csv",
        text: CHASE_CSV,
        saveProfileAs: "Chase copy",
      }),
    ).toMatchObject({ ok: true });
    expect(db.select().from(bankProfiles).all()).toHaveLength(1);
  });

  it("leaves no profile behind when the import is rejected", () => {
    const { db, acct, deps } = setup();
    const args = {
      accountId: acct.id,
      filename: "credit-union.csv",
      text: CUSTOM_CSV,
      override: CUSTOM_OVERRIDE,
      saveProfileAs: "My Credit Union",
    };
    expect(runCommitFlow(db, deps, args)).toMatchObject({ ok: true });
    db.delete(bankProfiles).run();

    const again = runCommitFlow(db, deps, { ...args, saveProfileAs: "Retry" });
    expect(again.ok).toBe(false);
    expect(db.select().from(bankProfiles).all()).toHaveLength(0);
  });

  it("reports a file it cannot parse", () => {
    const { db, acct, deps } = setup();
    expect(
      runCommitFlow(db, deps, {
        accountId: acct.id,
        filename: "empty.csv",
        text: "a,b,c\n",
      }),
    ).toEqual({ ok: false, error: "No rows parsed" });
  });
});
