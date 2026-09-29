"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { budgetGate } from "@/lib/budget/gate";
import { setupDefaults } from "@/lib/budget/setup";
import {
  copyBudgetMonth,
  listBudgetLeaves,
  saveBudgetMonth,
  setBudgetIncome as setBudgetIncomeStore,
  setBudgetRow,
  validBudgetRows,
} from "@/lib/budget/store";
import type { BudgetPage, Gate, SetupPage } from "@/lib/budget/types";
import { setCategoryRollover as setCategoryRolloverStore } from "@/lib/categories/manage";
import { todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import { goalNeededByGoalId, listGoals } from "@/lib/goals/store";
import { completeMonths, dataMonths } from "@/lib/insights/aggregate";
import { cachedBills, cachedBudgetPage, cachedLines } from "@/lib/loaders";
import { irregularItems, spreadByLeaf } from "@/lib/spreading/items";
import { listPlanned } from "@/lib/spreading/store";

type Fail = { ok: false; error: string };
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);
const categoryIdSchema = z.number().int().positive();
const amountSchema = z.number().int().min(0).max(100_000_000);

function refresh() {
  for (const p of ["/budget", "/goals", "/home", "/settings"])
    revalidatePath(p);
}

function resolveMonth(month?: string): string {
  return monthSchema.safeParse(month).success
    ? (month as string)
    : todayIso().slice(0, 7);
}

export async function getBudgetPage(month?: string): Promise<BudgetPage> {
  return cachedBudgetPage(todayIso(), resolveMonth(month));
}

export async function getBudgetSetup(
  month?: string,
): Promise<SetupPage & { gate: Gate }> {
  const db = getDb();
  const today = todayIso();
  const m = resolveMonth(month);
  const current = today.slice(0, 7);
  const lines = cachedLines();
  const leaves = listBudgetLeaves(db);
  const { bills, expectedIncomeMonthlyCents } = cachedBills(today);
  const gate = budgetGate(db, today);
  const avgWindow = completeMonths(dataMonths(lines), current)
    .filter((mo) => mo < m)
    .slice(-3);
  const goalNeeded = goalNeededByGoalId(listGoals(db, lines, today));
  const planned = listPlanned(db);
  const items = irregularItems({ bills, planned, today, leaves });
  const page = setupDefaults({
    lines,
    leaves,
    bills,
    planned: spreadByLeaf(items, { source: "planned" }),
    month: m,
    avgWindow,
    goalNeeded,
    expectedIncomeFallback: expectedIncomeMonthlyCents,
  });
  return { ...page, gate };
}

const saveBudgetSchema = z.object({
  month: monthSchema,
  incomeCents: amountSchema,
  rows: z.array(
    z.object({ categoryId: categoryIdSchema, amountCents: amountSchema }),
  ),
});
export async function saveBudget(input: {
  month: string;
  incomeCents: number;
  rows: { categoryId: number; amountCents: number }[];
}): Promise<{ ok: true } | Fail> {
  const p = saveBudgetSchema.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Invalid budget.",
    };
  const ids = p.data.rows.map((r) => r.categoryId);
  if (new Set(ids).size !== ids.length)
    return { ok: false, error: "Duplicate category." };
  const db = getDb();
  if (!validBudgetRows(db, p.data.rows))
    return { ok: false, error: "Unknown category." };
  saveBudgetMonth(db, p.data.month, p.data.rows, p.data.incomeCents);
  refresh();
  return { ok: true };
}

const setBudgetAmountSchema = z.object({
  month: monthSchema,
  categoryId: categoryIdSchema,
  amountCents: amountSchema,
});
export async function setBudgetAmount(input: {
  month: string;
  categoryId: number;
  amountCents: number;
}): Promise<{ ok: true } | Fail> {
  const p = setBudgetAmountSchema.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Invalid amount.",
    };
  const db = getDb();
  if (
    !validBudgetRows(db, [
      { categoryId: p.data.categoryId, amountCents: p.data.amountCents },
    ])
  )
    return { ok: false, error: "Unknown category." };
  setBudgetRow(db, p.data.month, p.data.categoryId, p.data.amountCents);
  refresh();
  return { ok: true };
}

const setBudgetIncomeSchema = z.object({
  month: monthSchema,
  cents: amountSchema,
});
export async function setBudgetIncome(input: {
  month: string;
  cents: number;
}): Promise<{ ok: true } | Fail> {
  const p = setBudgetIncomeSchema.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Invalid amount.",
    };
  setBudgetIncomeStore(getDb(), p.data.month, p.data.cents);
  refresh();
  return { ok: true };
}

const copyBudgetSchema = z.object({ from: monthSchema, to: monthSchema });
export async function copyBudget(input: {
  from: string;
  to: string;
}): Promise<{ ok: true; copied: number } | Fail> {
  const p = copyBudgetSchema.safeParse(input);
  if (!p.success)
    return { ok: false, error: p.error.issues[0]?.message ?? "Invalid month." };
  const r = copyBudgetMonth(getDb(), p.data.from, p.data.to);
  if (r.ok) refresh();
  return r;
}

const setCategoryRolloverSchema = z.object({
  id: categoryIdSchema,
  rollover: z.boolean(),
});
export async function setCategoryRollover(input: {
  id: number;
  rollover: boolean;
}): Promise<{ ok: true } | Fail> {
  const p = setCategoryRolloverSchema.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Invalid request.",
    };
  const r = setCategoryRolloverStore(getDb(), p.data.id, p.data.rollover);
  if (r.ok) refresh();
  return r;
}
