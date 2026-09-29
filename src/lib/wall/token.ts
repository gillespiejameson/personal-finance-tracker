import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "@/lib/db/client";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";

export const TOKEN_HASH_KEY = "wall_token_hash";
export const TOKEN_CREATED_KEY = "wall_token_created_at";

/** 32 random bytes as base64url: the display token, shown once. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Both rows land together: a half-written pair would read back as a token with no date. */
export function storeToken(db: Db, token: string, now: Date): void {
  db.transaction((tx) => {
    setSetting(tx as Db, TOKEN_HASH_KEY, hashToken(token));
    setSetting(tx as Db, TOKEN_CREATED_KEY, now.toISOString());
  });
}

export function clearToken(db: Db): void {
  deleteSetting(db, TOKEN_HASH_KEY);
  deleteSetting(db, TOKEN_CREATED_KEY);
}

export function tokenInfo(db: Db): { set: boolean; createdAt: string | null } {
  const hash = getSetting<string | null>(db, TOKEN_HASH_KEY, null);
  return {
    set: typeof hash === "string" && hash.length > 0,
    createdAt: hash
      ? getSetting<string | null>(db, TOKEN_CREATED_KEY, null)
      : null,
  };
}

/** Constant-time comparison of the presented token's hash with the stored one. */
export function verifyToken(
  db: Db,
  presented: string | null | undefined,
): boolean {
  const stored = getSetting<string | null>(db, TOKEN_HASH_KEY, null);
  if (!stored || !presented) return false;
  const a = Buffer.from(hashToken(presented), "hex");
  const b = Buffer.from(stored, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
