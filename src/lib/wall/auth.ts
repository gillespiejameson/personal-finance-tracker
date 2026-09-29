import type { Db } from "@/lib/db/client";
import { verifyToken } from "./token";
import { DEVICE_COOKIE } from "./types";

export function bearerFrom(authorization: string | null): string | null {
  const m = authorization?.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

export function cookieValue(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      // A malformed cookie is not a token: treat it as absent, never as an error.
      return null;
    }
  }
  return null;
}

/** The hub sends a bearer header; an enrolled display sends the cookie. Header wins. */
export function presentedToken(i: {
  authorization: string | null;
  cookie: string | null;
}): string | null {
  return bearerFrom(i.authorization) ?? cookieValue(i.cookie, DEVICE_COOKIE);
}

export function isAuthorizedDisplay(
  db: Db,
  i: { authorization: string | null; cookie: string | null },
): boolean {
  return verifyToken(db, presentedToken(i));
}
