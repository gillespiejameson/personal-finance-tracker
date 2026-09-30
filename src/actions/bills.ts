"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { CategoryOption } from "@/actions/review";
import { listCategoryOptions } from "@/actions/transactions";
import { todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import { recurring } from "@/lib/db/schema";
import { cachedBills } from "@/lib/loaders";
import { createAlias, validateAlias } from "@/lib/normalize/aliases";
import type { Cadence } from "@/lib/recurring/detect";
import {
  type Bill,
  listBills,
  markAsBill,
  refreshRecurring,
  removeManualBill,
} from "@/lib/recurring/refresh";
import { applyRules, directionOf, ensureUserRule } from "@/lib/rules/engine";

export type { Bill };

type Fail = { ok: false; error: string };
const id = z.number().int().positive();
function refresh() {
  for (const p of ["/bills", "/home", "/insights"]) revalidatePath(p);
}
/** A bill added or removed by hand also changes the screens it was declared from and the projections. */
function refreshAll() {
  refresh();
  for (const p of ["/transactions", "/review", "/forecast", "/budget"])
    revalidatePath(p);
}
const cadence = z.enum([
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "annual",
]);

export async function getBills(opts: { includeDismissed?: boolean } = {}) {
  const db = getDb();
  return {
    ...listBills(db, { includeDismissed: opts.includeDismissed }),
    categories: (await listCategoryOptions()) as CategoryOption[],
  };
}
export async function upcomingBills(days = 7): Promise<Bill[]> {
  const n = z.number().int().min(0).max(60).safeParse(days).success ? days : 7;
  return cachedBills(todayIso()).bills.filter(
    (b) =>
      b.active &&
      !b.dismissed &&
      !b.isIncome &&
      b.dueInDays >= 0 &&
      b.dueInDays <= n,
  );
}
export async function dismissBill(input: number): Promise<{ ok: true } | Fail> {
  const p = id.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid id." };
  getDb()
    .update(recurring)
    .set({ dismissed: true })
    .where(eq(recurring.id, p.data))
    .run();
  refresh();
  return { ok: true };
}
export async function undismissBill(
  input: number,
): Promise<{ ok: true } | Fail> {
  const p = id.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid id." };
  getDb()
    .update(recurring)
    .set({ dismissed: false })
    .where(eq(recurring.id, p.data))
    .run();
  refresh();
  return { ok: true };
}
export async function refreshBills(): Promise<
  { ok: true; detected: number; likely: number } | Fail
> {
  const r = refreshRecurring(getDb());
  refresh();
  return { ok: true, detected: r.detected, likely: r.likely };
}
export async function markAsBillAction(input: {
  transactionId: number;
  cadence: Cadence;
}): Promise<{ ok: true; id: number; created: boolean } | Fail> {
  const p = z.object({ transactionId: id, cadence }).safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  const r = markAsBill(getDb(), p.data);
  if (!r.ok) return r;
  // A row declared on an uncategorized charge adopts the merchant's majority
  // category here, rather than waiting for the next refresh.
  if (r.created) refreshRecurring(getDb());
  refreshAll();
  return r;
}
export async function removeManualBillAction(
  input: number,
): Promise<{ ok: true } | Fail> {
  const p = id.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid id." };
  if (!removeManualBill(getDb(), p.data))
    return { ok: false, error: "Only manual bills can be removed." };
  refreshAll();
  return { ok: true };
}
export async function setBillCategory(input: {
  billId: number;
  categoryId: number;
}): Promise<{ ok: true; applied: number } | Fail> {
  const p = z.object({ billId: id, categoryId: id }).safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  const db = getDb();
  const rec = db
    .select({ merchant: recurring.merchant, avgCents: recurring.avgCents })
    .from(recurring)
    .where(eq(recurring.id, p.data.billId))
    .get();
  if (!rec) return { ok: false, error: "Bill not found." };
  // The rule is keyed by the row's merchant, in the row's direction: a bill's
  // rule should not catch the same payee's credits, nor an income stream's
  // rule its debits.
  ensureUserRule(
    db,
    {
      pattern: rec.merchant,
      field: "merchant",
      categoryId: p.data.categoryId,
    },
    { direction: directionOf(rec.avgCents) },
  );
  const { applied } = applyRules(db, { onlyUncategorized: false });
  refreshRecurring(db);
  refresh();
  return { ok: true, applied };
}
export async function renameBillMerchant(input: {
  merchant: string;
  name: string;
}): Promise<{ ok: true; updated: number } | Fail> {
  const p = z
    .object({
      merchant: z.string().min(2).max(80),
      name: z.string().min(1).max(60),
    })
    .safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  const err = validateAlias({ pattern: p.data.merchant });
  if (err) return { ok: false, error: err };
  const db = getDb();
  const r = createAlias(db, {
    pattern: p.data.merchant,
    merchant: p.data.name,
  });
  refreshRecurring(db);
  refresh();
  return { ok: true, updated: r.updated };
}
