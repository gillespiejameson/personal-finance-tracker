"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { monthOf, todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import { comparePlans } from "@/lib/debt/simulate";
import {
  getDebtExtra,
  listDebtRows,
  setDebtExtra,
  setDebtTerms,
} from "@/lib/debt/store";
import type { DebtInput, DebtPage, Strategy } from "@/lib/debt/types";

type Fail = { ok: false; error: string };

function refresh() {
  for (const p of ["/debt", "/accounts", "/networth"]) revalidatePath(p);
}

function parseStrategy(strategy: string | undefined): Strategy {
  return strategy === "snowball" ? "snowball" : "avalanche";
}

export async function getDebtPage(strategy?: string): Promise<DebtPage> {
  const db = getDb();
  const today = todayIso();
  const resolvedStrategy = parseStrategy(strategy);

  const debts = listDebtRows(db, today);
  const extraCents = getDebtExtra(db);

  const readyDebts: DebtInput[] = debts
    .filter((d) => d.ready)
    .map((d) => ({
      id: d.id,
      name: d.name,
      balanceCents: d.balanceCents as number,
      aprBps: d.aprBps as number,
      minPaymentCents: d.minPaymentCents as number,
    }));

  const startMonth = monthOf(today);
  const plans =
    readyDebts.length > 0
      ? comparePlans(readyDebts, extraCents, startMonth)
      : null;
  const plan = plans ? plans[resolvedStrategy] : null;
  const comparison = plans
    ? { avalanche: plans.avalanche.totals, snowball: plans.snowball.totals }
    : null;

  return {
    today,
    strategy: resolvedStrategy,
    extraCents,
    debts,
    plan,
    comparison,
  };
}

const setDebtTermsSchema = z.object({
  accountId: z.number().int().positive(),
  aprPercent: z
    .number()
    .min(0)
    .max(100)
    .refine(
      (v) =>
        Number.isInteger(Math.round(v * 100)) &&
        Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
      "Use up to two decimals.",
    ),
  minPaymentCents: z.number().int().min(0),
});

export async function setDebtTermsAction(input: {
  accountId: number;
  aprPercent: number;
  minPaymentCents: number;
}): Promise<{ ok: true } | Fail> {
  const p = setDebtTermsSchema.safeParse(input);
  if (!p.success)
    return { ok: false, error: p.error.issues[0]?.message ?? "Invalid terms." };
  const { accountId, aprPercent, minPaymentCents } = p.data;
  const aprBps = Math.round(aprPercent * 100);

  const db = getDb();
  const result = setDebtTerms(db, accountId, aprBps, minPaymentCents);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

const setDebtExtraSchema = z.object({
  cents: z
    .number()
    .int()
    .min(0)
    .max(1_000_000_000, "That amount is too large."),
});

export async function setDebtExtraAction(input: {
  cents: number;
}): Promise<{ ok: true } | Fail> {
  const p = setDebtExtraSchema.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Invalid amount.",
    };

  const db = getDb();
  setDebtExtra(db, p.data.cents);
  refresh();
  return { ok: true };
}
