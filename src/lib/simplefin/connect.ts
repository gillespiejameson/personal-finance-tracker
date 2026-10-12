import type { Db } from "@/lib/db/client";
import { claimAccessUrl, type FetchFn } from "./client";
import { setAccessUrl } from "./store";
import { runSync } from "./sync";
import { decodeSetupToken } from "./token";
import type { SyncOutcome } from "./types";

export const DB_UNAVAILABLE_ERROR =
  "Couldn't open the app's database, so the setup token was not used. Fix that, then try the same token again.";
export const CONNECT_SAVE_ERROR =
  "SimpleFIN accepted the setup token, but saving the connection failed. That token is now used up; create a new setup token and try again.";

/**
 * Connect with a setup token: claim it, store the access URL, and pull the
 * first 90 days so the card has accounts to map.
 *
 * A setup token works exactly once, so everything that can fail locally runs
 * before the claim: the token's shape is checked and the database opened
 * first, and a failure there leaves the token usable. Only saving the result
 * can still fail after the claim, and that says the token is spent.
 *
 * Never throws, and no exception's text reaches the caller: it could name the
 * claim URL, the access URL or a local path.
 */
export async function connectWithToken(
  openDb: () => Db,
  fetchFn: FetchFn,
  token: string,
  now: Date,
): Promise<{ ok: true; sync: SyncOutcome } | { ok: false; error: string }> {
  const decoded = decodeSetupToken(token);
  if (!decoded.ok) return decoded;

  let db: Db;
  try {
    db = openDb();
  } catch {
    return { ok: false, error: DB_UNAVAILABLE_ERROR };
  }

  const claimed = await claimAccessUrl(fetchFn, decoded.claimUrl);
  if (!claimed.ok) return claimed;

  try {
    setAccessUrl(db, claimed.accessUrl, now);
  } catch {
    return { ok: false, error: CONNECT_SAVE_ERROR };
  }
  const sync = await runSync(db, fetchFn, { now, automatic: false });
  return { ok: true, sync };
}
