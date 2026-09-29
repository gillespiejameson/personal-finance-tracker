"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dismiss, undismiss } from "@/lib/anomalies/store";
import type { AlertsPage } from "@/lib/anomalies/types";
import { todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import { cachedAlerts } from "@/lib/loaders";

type Fail = { ok: false; error: string };
const alertKey = z.string().regex(/^[a-z-]+:\d+$/);

function refresh() {
  for (const p of ["/alerts", "/home", "/weekly"]) revalidatePath(p);
}

export async function getAlerts(
  opts: { includeDismissed?: boolean } = {},
): Promise<AlertsPage & { dismissedKeys: string[] }> {
  return cachedAlerts(todayIso(), opts.includeDismissed === true);
}

export async function dismissAlert(
  input: string,
): Promise<{ ok: true } | Fail> {
  const p = alertKey.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid key." };
  dismiss(getDb(), p.data);
  refresh();
  return { ok: true };
}

export async function undismissAlert(
  input: string,
): Promise<{ ok: true } | Fail> {
  const p = alertKey.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid key." };
  undismiss(getDb(), p.data);
  refresh();
  return { ok: true };
}
