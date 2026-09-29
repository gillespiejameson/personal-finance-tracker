import { z } from "zod";
import { parseSfinUrl } from "./token";
import type { SfinPayload, Window } from "./types";

/**
 * The SimpleFIN protocol client. Every function takes `fetch` as a parameter
 * so tests never touch the network; the real actions pass `globalThis.fetch`.
 * The access URL is a secret: it is never logged and never part of an error.
 */

export const NETWORK_ERROR = "Couldn't reach SimpleFIN.";
export const REJECTED_ERROR =
  "SimpleFIN rejected the connection; reconnect with a new setup token.";
export const SUBSCRIPTION_ERROR = "SimpleFIN subscription needs attention.";
export const CLAIM_USED_ERROR =
  "That setup token was already used or is invalid; get a new one from SimpleFIN.";
export const UNREADABLE_ERROR = "SimpleFIN returned an unreadable response.";

// Bridges send `null` for a field they have nothing for, so every optional
// field is nullish; `map.ts` reads null exactly as it reads a missing key.
const transactionSchema = z.object({
  id: z.string().min(1),
  posted: z.number(),
  amount: z.string(),
  description: z.string().nullish().default(""),
  payee: z.string().nullish(),
  memo: z.string().nullish(),
  pending: z.boolean().nullish(),
  transacted_at: z.number().nullish(),
});

const accountSchema = z.object({
  id: z.string().min(1),
  org: z
    .object({ domain: z.string().nullish(), name: z.string().nullish() })
    .nullish(),
  name: z.string(),
  currency: z.string(),
  balance: z.string(),
  "available-balance": z.string().nullish(),
  "balance-date": z.number(),
  transactions: z.array(transactionSchema).nullish(),
});

export const payloadSchema = z.object({
  errors: z.array(z.string()).nullish(),
  accounts: z.array(accountSchema),
});

export type FetchFn = typeof fetch;

/** `https://…@host/path` for display; the credentials never leave the database. */
export function maskAccessUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//…@${u.host}${u.pathname}`;
  } catch {
    return "…";
  }
}

/** Exchange a claim URL for an access URL. Works exactly once per setup token. */
export async function claimAccessUrl(
  fetchFn: FetchFn,
  claimUrl: string,
): Promise<{ ok: true; accessUrl: string } | { ok: false; error: string }> {
  if (!parseSfinUrl(claimUrl))
    return { ok: false, error: "That doesn't look like a setup token." };
  let res: Response;
  try {
    res = await fetchFn(claimUrl, { method: "POST", body: "" });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  if (res.status === 403) return { ok: false, error: CLAIM_USED_ERROR };
  if (!res.ok) return { ok: false, error: `SimpleFIN returned ${res.status}.` };
  const body = (await res.text()).trim();
  const u = parseSfinUrl(body);
  if (!u || !u.username || !u.password)
    return { ok: false, error: UNREADABLE_ERROR };
  return { ok: true, accessUrl: u.toString() };
}

function basicAuth(u: URL): string {
  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

/** `GET <accessUrl>/accounts?start-date=&end-date=[&pending=1][&balances-only=1]`. */
export function accountsUrl(
  accessUrl: URL,
  window: Window,
  opts: { pending?: boolean; balancesOnly?: boolean } = {},
): string {
  const base = new URL(accessUrl.toString());
  base.username = "";
  base.password = "";
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/accounts`;
  base.search = "";
  base.searchParams.set("start-date", String(window.start));
  base.searchParams.set("end-date", String(window.end));
  if (opts.pending) base.searchParams.set("pending", "1");
  if (opts.balancesOnly) base.searchParams.set("balances-only", "1");
  return base.toString();
}

export async function fetchAccounts(
  fetchFn: FetchFn,
  accessUrl: string,
  window: Window,
  opts: { pending?: boolean; balancesOnly?: boolean } = {},
): Promise<
  | { ok: true; payload: SfinPayload }
  | { ok: false; status?: number; error: string }
> {
  const u = parseSfinUrl(accessUrl);
  if (!u || !u.username || !u.password)
    return { ok: false, error: REJECTED_ERROR };
  let res: Response;
  try {
    res = await fetchFn(accountsUrl(u, window, opts), {
      method: "GET",
      headers: { Authorization: basicAuth(u), Accept: "application/json" },
    });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  if (res.status === 403)
    return { ok: false, status: 403, error: REJECTED_ERROR };
  if (res.status === 402)
    return { ok: false, status: 402, error: SUBSCRIPTION_ERROR };
  if (!res.ok)
    return {
      ok: false,
      status: res.status,
      error: `SimpleFIN returned ${res.status}.`,
    };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, status: res.status, error: UNREADABLE_ERROR };
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success)
    return { ok: false, status: res.status, error: UNREADABLE_ERROR };
  return { ok: true, payload: parsed.data };
}
