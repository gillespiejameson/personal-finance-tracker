import { and, eq, sql } from "drizzle-orm";
import { addDays, daysBetween, todayIso } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import { categories, recurring, transactions } from "@/lib/db/schema";
import {
  amountKeyOf,
  amountTolerance,
  type Cadence,
  type Confidence,
  cadenceInterval,
  DEFAULT_AMOUNT_FRACTION,
  detectRecurring,
  FIXED_AMOUNT_FRACTION,
  monthlyize,
  type Point,
  type Recurrence,
  type Series,
} from "./detect";

type Row = {
  date: string;
  amountCents: number;
  merchant: string;
  categoryId: number | null;
  kind: string | null;
  isFixed: boolean | null;
};

type Group = {
  merchant: string;
  points: Point[];
  cats: Map<number, { count: number; fixed: boolean }>;
};

type DetectSeries = Series & { fixed: boolean };

type RecurringRow = typeof recurring.$inferSelect;

/** `out:acme` / `in:acme`: a merchant's debits and credits are separate series. */
function seriesKey(amountCents: number, merchant: string): string {
  return `${amountCents > 0 ? "in" : "out"}:${merchant.toLowerCase()}`;
}

function keyOf(row: RecurringRow): number {
  // Rows written before Phase 7a carry no key; their average stands in.
  return row.amountKey ?? amountKeyOf(row.avgCents);
}

function buildSeries(rows: Row[]): DetectSeries[] {
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const income = r.kind === "income";
    if (!income && r.amountCents >= 0) continue; // refunds/inflows are not bills
    if (income && r.amountCents <= 0) continue;
    const key = seriesKey(r.amountCents, r.merchant);
    const g: Group = groups.get(key) ?? {
      merchant: r.merchant,
      points: [],
      cats: new Map(),
    };
    g.points.push({ date: r.date, amountCents: r.amountCents });
    if (r.categoryId !== null) {
      const c = g.cats.get(r.categoryId) ?? {
        count: 0,
        fixed: r.isFixed === true,
      };
      c.count++;
      g.cats.set(r.categoryId, c);
    }
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const majority = [...g.cats.entries()].sort(
      (x, y) => y[1].count - x[1].count,
    )[0];
    return {
      merchant: g.merchant,
      categoryId: majority?.[0] ?? null,
      fixed: majority?.[1].fixed ?? false,
      points: g.points,
    };
  });
}

function loadRows(db: Db): Row[] {
  return db
    .select({
      date: transactions.date,
      amountCents: transactions.amountCents,
      merchant: transactions.merchant,
      categoryId: transactions.categoryId,
      kind: sql<
        string | null
      >`(select p.kind from categories c join categories p on p.id = c.parent_id where c.id = ${transactions.categoryId})`,
      isFixed: categories.isFixed,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(eq(transactions.isTransfer, false))
    .all();
}

type ManualPoint = Point & { categoryId?: number | null };

/**
 * What a refresh writes onto a manual row from the merchant's transactions
 * (same sign; |amount − avgCents| ≤ toleranceCents, or any amount when the
 * tolerance is 0), or null when none match and the row should be left alone.
 * A row without a category adopts the matches' majority category; one that
 * has a category keeps it.
 */
export function advanceManual(
  row: {
    avgCents: number;
    toleranceCents: number;
    intervalDays: number;
    firstSeen: string | null;
    lastSeen: string;
    categoryId?: number | null;
  },
  points: ManualPoint[],
): {
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  nextExpected: string;
  categoryId?: number;
} | null {
  const matches = points.filter(
    (p) =>
      Math.sign(p.amountCents) === Math.sign(row.avgCents) &&
      (row.toleranceCents === 0 ||
        Math.abs(p.amountCents - row.avgCents) <= row.toleranceCents),
  );
  if (matches.length === 0) return null;
  const dates = matches.map((p) => p.date).sort();
  const lastSeen = dates[dates.length - 1];
  const earliest = row.firstSeen ?? row.lastSeen;
  const next = {
    occurrences: matches.length,
    firstSeen: dates[0] < earliest ? dates[0] : earliest,
    lastSeen,
    nextExpected: addDays(lastSeen, row.intervalDays),
  };
  if (row.categoryId !== null && row.categoryId !== undefined) return next;
  const votes = new Map<number, number>();
  for (const p of matches)
    if (p.categoryId !== null && p.categoryId !== undefined)
      votes.set(p.categoryId, (votes.get(p.categoryId) ?? 0) + 1);
  const majority = [...votes.entries()].sort((x, y) => y[1] - x[1])[0];
  return majority ? { ...next, categoryId: majority[0] } : next;
}

export type RefreshResult = {
  /** Confirmed recurrences found (three or more occurrences) that no manual row stands in for. */
  detected: number;
  /** Two-identical-charge pairs found that no manual row stands in for. */
  likely: number;
  added: number;
  removed: number;
};

export function refreshRecurring(
  db: Db,
  opts: { today?: string } = {},
): RefreshResult {
  const today = opts.today ?? todayIso();
  const rows = loadRows(db);
  const found: { r: Recurrence; fraction: number }[] = buildSeries(
    rows,
  ).flatMap((s) => {
    const fraction = s.fixed ? FIXED_AMOUNT_FRACTION : DEFAULT_AMOUNT_FRACTION;
    return detectRecurring(s, { amountFraction: fraction }).map((r) => ({
      r,
      fraction,
    }));
  });
  // Every non-transfer charge at the merchant, for advancing manual rows.
  const pointsByKey = new Map<string, ManualPoint[]>();
  for (const r of rows) {
    const key = seriesKey(r.amountCents, r.merchant);
    const list = pointsByKey.get(key) ?? [];
    list.push({
      date: r.date,
      amountCents: r.amountCents,
      categoryId: r.categoryId,
    });
    pointsByKey.set(key, list);
  }
  return db.transaction((tx) => {
    const existing = tx.select().from(recurring).all();
    const manual = existing.filter((e) => e.manual);
    const candidates = new Map<string, RecurringRow[]>();
    for (const e of existing) {
      if (e.manual) continue;
      const key = seriesKey(e.avgCents, e.merchant);
      candidates.set(key, [...(candidates.get(key) ?? []), e]);
    }
    const nearest = (
      list: RecurringRow[] | undefined,
      amountKey: number,
      tol: number,
    ): RecurringRow | undefined =>
      list
        ?.filter((e) => Math.abs(keyOf(e) - amountKey) <= tol)
        .sort(
          (a, b) =>
            Math.abs(keyOf(a) - amountKey) - Math.abs(keyOf(b) - amountKey),
        )[0];

    let added = 0;
    let detected = 0;
    let likely = 0;
    const keep = new Set<number>(manual.map((m) => m.id));
    // Pair every recurrence with its existing row first, so a recurrence
    // that matches nothing can tell whether the merchant's leftover row is
    // its own, re-keyed, or another cluster's.
    const plan: { r: Recurrence; key: string; prev?: RecurringRow }[] = [];
    for (const { r, fraction } of found) {
      const key = seriesKey(r.avgCents, r.merchant);
      const tol = amountTolerance(r.avgCents, fraction);
      // A manual row at this cluster stands in for what detection found, and
      // the cluster is not reported as a detection of its own.
      if (
        nearest(
          manual.filter((m) => seriesKey(m.avgCents, m.merchant) === key),
          r.amountKey,
          tol,
        )
      )
        continue;
      if (r.confidence === "confirmed") detected++;
      else likely++;
      const prev = nearest(candidates.get(key), r.amountKey, tol);
      if (prev)
        candidates.set(
          key,
          (candidates.get(key) ?? []).filter((e) => e.id !== prev.id),
        );
      plan.push({ r, key, prev });
    }
    for (const { r, key, prev } of plan) {
      // The merchant's only unmatched row is this bill re-keyed (re-priced
      // past the tolerance): the user's dismissal of it carries over.
      const leftover = candidates.get(key);
      const reKeyed = !prev && leftover?.length === 1 ? leftover[0] : undefined;
      if (reKeyed) candidates.set(key, []);
      const active = r.nextExpected >= addDays(today, -2 * r.intervalDays);
      const values = {
        merchant: r.merchant,
        categoryId: r.categoryId,
        cadence: r.cadence,
        intervalDays: r.intervalDays,
        avgCents: r.avgCents,
        amountKey: r.amountKey,
        toleranceCents: r.toleranceCents,
        occurrences: r.occurrences,
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
        nextExpected: r.nextExpected,
        confidence: r.confidence,
        active,
      };
      if (prev) {
        tx.update(recurring).set(values).where(eq(recurring.id, prev.id)).run();
        keep.add(prev.id);
      } else {
        const [row] = tx
          .insert(recurring)
          .values({ ...values, dismissed: reKeyed?.dismissed ?? false })
          .returning({ id: recurring.id })
          .all();
        keep.add(row.id);
        added++;
      }
    }
    for (const m of manual) {
      const next = advanceManual(
        m,
        pointsByKey.get(seriesKey(m.avgCents, m.merchant)) ?? [],
      );
      if (next)
        tx.update(recurring).set(next).where(eq(recurring.id, m.id)).run();
    }
    let removed = 0;
    for (const e of existing)
      if (!keep.has(e.id)) {
        tx.delete(recurring).where(eq(recurring.id, e.id)).run();
        removed++;
      }
    return { detected, likely, added, removed };
  });
}

/**
 * Declare a transaction the first occurrence of a bill. Refuses transfers;
 * an existing row for the same direction, merchant and dollar amount is
 * returned rather than duplicated.
 */
export function markAsBill(
  db: Db,
  input: { transactionId: number; cadence: Cadence },
): { ok: true; id: number; created: boolean } | { ok: false; error: string } {
  const t = db
    .select({
      date: transactions.date,
      amountCents: transactions.amountCents,
      merchant: transactions.merchant,
      categoryId: transactions.categoryId,
      isTransfer: transactions.isTransfer,
    })
    .from(transactions)
    .where(eq(transactions.id, input.transactionId))
    .get();
  if (!t) return { ok: false, error: "Transaction not found." };
  if (t.isTransfer) return { ok: false, error: "Transfers cannot be bills." };
  if (t.amountCents === 0)
    return { ok: false, error: "A zero-amount transaction cannot be a bill." };
  const amountKey = amountKeyOf(t.amountCents);
  const key = seriesKey(t.amountCents, t.merchant);
  const dup = db
    .select()
    .from(recurring)
    .all()
    .find(
      (e) =>
        seriesKey(e.avgCents, e.merchant) === key && keyOf(e) === amountKey,
    );
  if (dup) return { ok: true, id: dup.id, created: false };
  const intervalDays = cadenceInterval(input.cadence);
  const [row] = db
    .insert(recurring)
    .values({
      merchant: t.merchant,
      categoryId: t.categoryId,
      cadence: input.cadence,
      intervalDays,
      avgCents: t.amountCents,
      amountKey,
      toleranceCents: Math.max(Math.round(Math.abs(t.amountCents) * 0.15), 500),
      occurrences: 1,
      firstSeen: t.date,
      lastSeen: t.date,
      nextExpected: addDays(t.date, intervalDays),
      active: true,
      dismissed: false,
      manual: true,
      confidence: "manual",
    })
    .returning({ id: recurring.id })
    .all();
  return { ok: true, id: row.id, created: true };
}

/** Delete a manual bill; detected rows are left for refresh to manage. */
export function removeManualBill(db: Db, id: number): boolean {
  return (
    db
      .delete(recurring)
      .where(and(eq(recurring.id, id), eq(recurring.manual, true)))
      .run().changes > 0
  );
}

export type Bill = {
  id: number;
  merchant: string;
  categoryId: number | null;
  categoryName: string | null;
  color: string | null;
  cadence: Cadence;
  intervalDays: number;
  avgCents: number;
  monthlyCents: number;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  nextExpected: string;
  dueInDays: number;
  isNew: boolean;
  active: boolean;
  dismissed: boolean;
  recentAmounts: number[];
  isIncome: boolean;
  confidence: Confidence;
  manual: boolean;
};

export function listBills(
  db: Db,
  opts: { includeDismissed?: boolean; today?: string } = {},
): {
  bills: Bill[];
  monthlyTotalCents: number;
  expectedIncomeMonthlyCents: number;
} {
  const today = opts.today ?? todayIso();
  const rows = db
    .select({
      r: recurring,
      categoryName: categories.name,
      color: categories.color,
      parentId: categories.parentId,
    })
    .from(recurring)
    .leftJoin(categories, eq(categories.id, recurring.categoryId))
    .all();
  const parentKind = new Map(
    db
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .all()
      .map((c) => [c.id, c.kind]),
  );
  const bills: Bill[] = rows
    .filter(({ r }) => opts.includeDismissed || !r.dismissed)
    .map(({ r, categoryName, color, parentId }) => {
      const cadence = (r.cadence ?? "monthly") as Cadence;
      const isIncome =
        r.avgCents > 0 &&
        (parentId === null ? false : parentKind.get(parentId) === "income");
      // The sparkline is this row's cluster, not the merchant's: two bills at
      // one merchant each show their own history, and a detected row with no
      // tolerance (a bill charged to the cent, which is most of them) shows
      // only that exact amount. The exception is a manual row with a
      // tolerance of 0: there 0 means any amount, as `advanceManual` treats
      // it. A manual row with a tolerance is a cluster like any other.
      const inCluster =
        r.manual && r.toleranceCents === 0
          ? sql``
          : sql` and abs(amount_cents - ${r.avgCents}) <= ${r.toleranceCents}`;
      const recent = db
        .select({ amountCents: transactions.amountCents })
        .from(transactions)
        .where(
          sql`lower(${transactions.merchant}) = ${r.merchant.toLowerCase()} and ${transactions.isTransfer} = 0 and amount_cents ${isIncome ? sql`> 0` : sql`< 0`}${inCluster}`,
        )
        .orderBy(sql`${transactions.date} desc, ${transactions.id} desc`)
        .limit(6)
        .all()
        .map((x) => x.amountCents)
        .reverse();
      return {
        id: r.id,
        merchant: r.merchant,
        categoryId: r.categoryId,
        categoryName,
        color,
        cadence,
        intervalDays: r.intervalDays,
        avgCents: r.avgCents,
        monthlyCents: Math.abs(monthlyize(r.avgCents, cadence)),
        occurrences: r.occurrences,
        firstSeen: r.firstSeen ?? r.lastSeen,
        lastSeen: r.lastSeen,
        nextExpected: r.nextExpected,
        dueInDays: daysBetween(today, r.nextExpected),
        isNew: (r.firstSeen ?? r.lastSeen) >= addDays(today, -45),
        active: r.active,
        dismissed: r.dismissed,
        recentAmounts: recent,
        isIncome,
        confidence: r.confidence,
        manual: r.manual,
      };
    })
    .sort(
      (a, b) =>
        a.nextExpected.localeCompare(b.nextExpected) ||
        a.merchant.localeCompare(b.merchant),
    );
  const live = bills.filter((b) => b.active && !b.dismissed);
  return {
    bills,
    monthlyTotalCents: live
      .filter((b) => !b.isIncome)
      .reduce((s, b) => s + b.monthlyCents, 0),
    expectedIncomeMonthlyCents: live
      .filter((b) => b.isIncome)
      .reduce((s, b) => s + b.monthlyCents, 0),
  };
}
