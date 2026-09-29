import { ensureDefaultCategories } from "@/lib/categories/ensure";
import type { Db } from "@/lib/db/client";
import { bankProfiles } from "@/lib/db/schema";
import { ensureBuiltinAliases } from "@/lib/normalize/aliases";
import { ensureBuiltinRules } from "@/lib/rules/builtin";
import { commitImport } from "./commit";
import { buildPreview } from "./preview";
import { canSaveProfile } from "./profileGuard";
import type { BankProfile } from "./types";

export type CommitFlowDeps = {
  /** Snapshot the database before touching it; returns the backup's path. */
  backup: () => string;
  builtins: BankProfile[];
};

export type CommitFlowArgs = {
  accountId: number;
  filename: string;
  text: string;
  override?: Partial<BankProfile>;
  saveProfileAs?: string;
};

export type CommitFlowResult =
  | {
      ok: true;
      importId: number;
      newCount: number;
      dupCount: number;
      flaggedCount: number;
      categorized: number;
    }
  | { ok: false; error: string };

/**
 * Parse a statement, back the database up, and commit the rows.
 *
 * Everything the server action does after validating its input lives here so
 * it can be tested against an in-memory database with a stub backup, rather
 * than only through Next's server-action plumbing.
 */
export function runCommitFlow(
  db: Db,
  deps: CommitFlowDeps,
  args: CommitFlowArgs,
): CommitFlowResult {
  ensureDefaultCategories(db);
  ensureBuiltinAliases(db);
  ensureBuiltinRules(db);
  const saved = db.select().from(bankProfiles).all() as BankProfile[];
  const preview = buildPreview(
    args.filename,
    args.text,
    [...saved, ...deps.builtins],
    args.override,
  );
  if (!preview.rows.length) return { ok: false, error: "No rows parsed" };

  let backupPath: string | null = null;
  try {
    backupPath = deps.backup();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Backup failed, import cancelled: ${msg}` };
    }
    backupPath = null; // no database file yet: nothing to back up
  }

  let res: ReturnType<typeof commitImport>;
  try {
    res = commitImport(db, {
      accountId: args.accountId,
      filename: args.filename,
      text: args.text,
      rows: preview.rows,
      backupPath,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "already-imported")
      return { ok: false, error: "This exact file was already imported." };
    throw e;
  }

  // Only remember the wizard's mapping once the import it describes has
  // actually landed, so a rejected file leaves no stray profile behind.
  if (args.saveProfileAs && preview.profile) {
    const { id: _id, ...p } = preview.profile;
    const candidate = { ...p, name: args.saveProfileAs, builtin: false };
    if (canSaveProfile(candidate, deps.builtins)) {
      db.insert(bankProfiles).values(candidate).onConflictDoNothing().run();
    }
  }

  return { ok: true, ...res };
}
