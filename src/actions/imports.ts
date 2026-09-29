"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { backupDb } from "@/lib/db/backup";
import { dbPath, getDb } from "@/lib/db/client";
import { bankProfiles } from "@/lib/db/schema";
import { undoImport } from "@/lib/import/commit";
import { type CommitFlowResult, runCommitFlow } from "@/lib/import/commitFlow";
import { buildPreview, type PreviewResult } from "@/lib/import/preview";
import { BUILTIN_PROFILES } from "@/lib/import/profiles";
import type { BankProfile } from "@/lib/import/types";
import { refreshRecurring } from "@/lib/recurring/refresh";

const overrideSchema = z.object({
  name: z.string().min(1).optional(),
  dateCol: z.string().optional(),
  descCol: z.string().optional(),
  amountCol: z.string().nullable().optional(),
  debitCol: z.string().nullable().optional(),
  creditCol: z.string().nullable().optional(),
  balanceCol: z.string().nullable().optional(),
  dateFormat: z.enum(["MDY", "DMY", "YMD"]).optional(),
  signConvention: z
    .enum(["outflow_negative", "outflow_positive", "debit_credit_cols"])
    .optional(),
  skipRows: z.number().int().min(0).optional(),
});
export type ProfileOverride = z.infer<typeof overrideSchema>;

/** Character cap matching the 6 MB server-action body limit in next.config.ts. */
const MAX_TEXT_CHARS = 6 * 1024 * 1024;

const commitArgs = z.object({
  accountId: z.number().int().positive(),
  filename: z.string().min(1),
  text: z.string().min(1).max(MAX_TEXT_CHARS),
  override: overrideSchema.optional(),
  saveProfileAs: z.string().min(1).optional(),
});

function allProfiles(): BankProfile[] {
  const saved = getDb().select().from(bankProfiles).all() as BankProfile[];
  return [...saved, ...BUILTIN_PROFILES];
}

export async function previewFile(
  filename: string,
  text: string,
  override?: ProfileOverride,
): Promise<PreviewResult> {
  const o = override ? overrideSchema.parse(override) : undefined;
  return buildPreview(filename, text, allProfiles(), o);
}

export async function commitFile(input: {
  accountId: number;
  filename: string;
  text: string;
  override?: ProfileOverride;
  saveProfileAs?: string;
}): Promise<CommitFlowResult> {
  const parsed = commitArgs.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: `That import request wasn't valid: ${parsed.error.issues[0]?.message ?? "unknown problem"}`,
    };
  const res = runCommitFlow(
    getDb(),
    { backup: () => backupDb(dbPath()), builtins: BUILTIN_PROFILES },
    parsed.data,
  );
  if (res.ok) revalidatePath("/transactions");
  return res;
}

export async function undoImportAction(importId: number) {
  const db = getDb();
  const n = undoImport(db, importId);
  refreshRecurring(db);
  revalidatePath("/transactions");
  revalidatePath("/bills");
  revalidatePath("/home");
  return { removed: n };
}
