"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guessAccountType } from "@/lib/accounts/type-guess";
import { getDb } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { claimAccessUrl } from "@/lib/simplefin/client";
import {
  clearConnection,
  getConnection,
  listLinkedAccounts,
  mapAccount,
  setAccessUrl,
  setAuto,
  setEnabled,
} from "@/lib/simplefin/store";
import { runSync, SYNC_FAILED_ERROR } from "@/lib/simplefin/sync";
import { decodeSetupToken } from "@/lib/simplefin/token";
import type { Connection, SyncOutcome } from "@/lib/simplefin/types";

type Fail = { ok: false; error: string };

/** The flat failure every sync entry point falls back to; never an exception's text. */
const FAILED: Fail = { ok: false, error: SYNC_FAILED_ERROR };

/** Everything a sync can move: transactions, balances, bills, budget, forecast. */
function refresh() {
  for (const p of [
    "/settings",
    "/home",
    "/transactions",
    "/review",
    "/bills",
    "/insights",
    "/budget",
    "/networth",
    "/forecast",
    "/weekly",
  ])
    revalidatePath(p);
}

export async function getConnectionAction(): Promise<Connection> {
  return getConnection(getDb());
}

const tokenSchema = z.object({ token: z.string().min(1).max(4000) });

/**
 * Claim the setup token, store the access URL, and pull the first 90 days so
 * the card has accounts to map. The access URL never leaves the server.
 */
export async function connectAction(
  input: unknown,
): Promise<{ ok: true; sync: SyncOutcome } | Fail> {
  try {
    const p = tokenSchema.safeParse(input);
    if (!p.success) return { ok: false, error: "Paste a setup token." };
    const decoded = decodeSetupToken(p.data.token);
    if (!decoded.ok) return decoded;

    const claimed = await claimAccessUrl(globalThis.fetch, decoded.claimUrl);
    if (!claimed.ok) return claimed;

    const db = getDb();
    setAccessUrl(db, claimed.accessUrl, new Date());
    const sync = await runSync(db, globalThis.fetch, {
      now: new Date(),
      automatic: false,
    });
    refresh();
    return { ok: true, sync };
  } catch {
    // The exception could name the claim or access URL; the client sees neither.
    return FAILED;
  }
}

export async function disconnectAction(): Promise<{ ok: true }> {
  clearConnection(getDb());
  refresh();
  return { ok: true };
}

const mapSchema = z.object({
  sfinId: z.string().min(1),
  accountId: z.union([
    z.number().int().positive(),
    z.literal("create"),
    z.null(),
  ]),
});

export async function mapAccountAction(
  input: unknown,
): Promise<{ ok: true } | Fail> {
  const p = mapSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  const db = getDb();
  const { sfinId } = p.data;

  let accountId: number | null;
  if (p.data.accountId === "create") {
    const linked = listLinkedAccounts(db).find((a) => a.sfinId === sfinId);
    if (!linked) return { ok: false, error: "Unknown SimpleFIN account." };
    if (linked.currency !== "USD")
      return { ok: false, error: "Only USD accounts can be synced." };
    const [created] = db
      .insert(accounts)
      .values({
        name: linked.name.slice(0, 60),
        type: guessAccountType(`${linked.orgName ?? ""} ${linked.name}`),
        institution: linked.orgName ? linked.orgName.slice(0, 60) : null,
      })
      .returning()
      .all();
    accountId = created.id;
  } else {
    accountId = p.data.accountId;
  }

  const r = mapAccount(db, sfinId, accountId);
  if (r.ok) {
    refresh();
    revalidatePath("/accounts");
  }
  return r;
}

const enabledSchema = z.object({
  sfinId: z.string().min(1),
  enabled: z.boolean(),
});

export async function setEnabledAction(
  input: unknown,
): Promise<{ ok: true } | Fail> {
  const p = enabledSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  setEnabled(getDb(), p.data.sfinId, p.data.enabled);
  refresh();
  return { ok: true };
}

export async function setAutoAction(
  input: unknown,
): Promise<{ ok: true } | Fail> {
  const p = z.object({ auto: z.boolean() }).safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  setAuto(getDb(), p.data.auto);
  revalidatePath("/settings");
  revalidatePath("/home");
  return { ok: true };
}

/**
 * `runSync` can report a failure after earlier windows already committed, so
 * the caller refreshes whatever the outcome says.
 */
export async function syncNowAction(input?: unknown): Promise<SyncOutcome> {
  try {
    const p = z
      .object({ automatic: z.boolean().optional() })
      .safeParse(input ?? {});
    const automatic = p.success ? (p.data.automatic ?? false) : false;
    const outcome = await runSync(getDb(), globalThis.fetch, {
      now: new Date(),
      automatic,
    });
    refresh();
    return outcome;
  } catch {
    return FAILED;
  }
}

export async function loadOlderAction(): Promise<SyncOutcome> {
  try {
    const outcome = await runSync(getDb(), globalThis.fetch, {
      now: new Date(),
      automatic: false,
      olderHistory: true,
    });
    refresh();
    return outcome;
  } catch {
    return FAILED;
  }
}
