"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDays, isIsoDate, todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import {
  deltaAvailable,
  latestBalances,
  netWorthAt,
  netWorthSeries,
} from "@/lib/networth/series";
import { listSnapshots, setBalance } from "@/lib/networth/store";
import {
  type AccountBalance,
  LIABILITY_TYPES,
  type NetWorthPage,
} from "@/lib/networth/types";

type Fail = { ok: false; error: string };

function refresh() {
  for (const p of ["/networth", "/accounts", "/home"]) revalidatePath(p);
}

export async function getNetWorthPage(): Promise<NetWorthPage> {
  const db = getDb();
  const today = todayIso();

  const rows = db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      color: accounts.color,
    })
    .from(accounts)
    .all();

  const accountInfos = rows.map((a) => ({
    id: a.id,
    isLiability: LIABILITY_TYPES.has(a.type),
  }));
  const snapshots = listSnapshots(db);
  const totals = netWorthAt(snapshots, accountInfos, today);
  const series = netWorthSeries(snapshots, accountInfos, today);

  const cutoff = addDays(today, -30);
  const deltaCents = deltaAvailable(snapshots, accountInfos, today, cutoff)
    ? totals.netWorthCents -
      netWorthAt(snapshots, accountInfos, cutoff).netWorthCents
    : null;

  const latest = latestBalances(snapshots, today);
  const accountBalances: AccountBalance[] = rows.map((a) => {
    const bal = latest.get(a.id);
    return {
      id: a.id,
      name: a.name,
      color: a.color,
      type: a.type,
      isLiability: LIABILITY_TYPES.has(a.type),
      balanceCents: bal?.balanceCents ?? null,
      asOf: bal?.date ?? null,
    };
  });

  return {
    today,
    netWorthCents: totals.netWorthCents,
    assetsCents: totals.assetsCents,
    liabilitiesCents: totals.liabilitiesCents,
    deltaCents,
    series,
    accounts: accountBalances,
  };
}

const setBalanceSchema = z.object({
  accountId: z.number().int().positive(),
  date: z
    .string()
    .refine(isIsoDate, "Invalid date.")
    .refine((d) => d <= todayIso(), "Pick today or an earlier date."),
  balanceCents: z
    .number()
    .int()
    .min(-1_000_000_000, "That amount is too large.")
    .max(1_000_000_000, "That amount is too large."),
});

export async function setBalanceAction(input: {
  accountId: number;
  date: string;
  balanceCents: number;
}): Promise<{ ok: true } | Fail> {
  const p = setBalanceSchema.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Invalid balance.",
    };
  const { accountId, date, balanceCents } = p.data;

  const db = getDb();
  const [account] = db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .all();
  if (!account) return { ok: false, error: "Account not found." };

  if (LIABILITY_TYPES.has(account.type) && balanceCents < 0) {
    return {
      ok: false,
      error: "Enter the amount owed as a positive number.",
    };
  }

  setBalance(db, accountId, date, balanceCents);
  refresh();
  return { ok: true };
}
