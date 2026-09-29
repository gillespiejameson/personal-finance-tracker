import { z } from "zod";
import { addDays, daysBetween, isIsoDate, monthEnd } from "@/lib/dates";
import type { Db } from "@/lib/db/client";
import type { Bill } from "@/lib/recurring/refresh";
import { getSetting } from "@/lib/settings";
import type { PaydayConfig, ResolvedPayday } from "./types";

export const PAYDAY_KEY = "payday";
const day = z.number().int().min(1).max(31);
export const paydaySchema = z.discriminatedUnion("schedule", [
  z.object({
    schedule: z.enum(["weekly", "biweekly"]),
    anchor: z.string().refine(isIsoDate, "Pick a date."),
  }),
  z.object({
    schedule: z.literal("semimonthly"),
    days: z
      .tuple([day, day])
      .refine(([a, b]) => a !== b, "Pick two different days."),
  }),
  z.object({ schedule: z.literal("monthly"), day }),
]) satisfies z.ZodType<PaydayConfig>;

function clampDay(month: string, d: number): string {
  const last = Number(monthEnd(month).slice(8));
  return `${month}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** First schedule date strictly after `today`. */
export function nextPayday(cfg: PaydayConfig, today: string): string {
  if ("anchor" in cfg) {
    const step = cfg.schedule === "weekly" ? 7 : 14;
    const diff = daysBetween(cfg.anchor, today); // negative when the anchor is in the future
    let n = diff < 0 ? 0 : Math.floor(diff / step) + 1;
    let d = addDays(cfg.anchor, n * step);
    while (d <= today) {
      n += 1;
      d = addDays(cfg.anchor, n * step);
    }
    return d;
  }
  const month = today.slice(0, 7);
  const days =
    cfg.schedule === "monthly"
      ? [cfg.day]
      : [...cfg.days].sort((a, b) => a - b);
  for (const m of [month, nextMonth(month)]) {
    for (const d of days) {
      const iso = clampDay(m, d);
      if (iso > today) return iso;
    }
  }
  return clampDay(nextMonth(nextMonth(month)), days[0]); // unreachable in practice
}

export function inferPayday(bills: Bill[]): PaydayConfig | null {
  const income = bills
    .filter((b) => b.isIncome && b.active && !b.dismissed)
    .sort((a, b) => b.monthlyCents - a.monthlyCents)[0];
  if (!income) return null;
  if (income.cadence === "weekly" || income.cadence === "biweekly")
    return { schedule: income.cadence, anchor: income.nextExpected };
  if (income.cadence === "monthly")
    return { schedule: "monthly", day: Number(income.nextExpected.slice(8)) };
  return null;
}

export function resolvePayday(
  db: Db,
  bills: Bill[],
  today: string,
): ResolvedPayday {
  const stored = paydaySchema.safeParse(
    getSetting<unknown>(db, PAYDAY_KEY, null),
  );
  const config = stored.success
    ? (stored.data as PaydayConfig)
    : inferPayday(bills);
  if (!config) return null;
  const next = nextPayday(config, today);
  return {
    config,
    inferred: !stored.success,
    next,
    daysUntil: daysBetween(today, next),
  };
}
