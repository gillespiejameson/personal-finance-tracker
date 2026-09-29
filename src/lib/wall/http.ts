import type { Db } from "@/lib/db/client";
import { isAuthorizedDisplay } from "./auth";
import { loadWallSummary } from "./load";
import { requestOrigin } from "./origin";
import { verifyToken } from "./token";
import { DEVICE_COOKIE, NOT_ENROLLED } from "./types";

const NO_STORE = { "Cache-Control": "no-store" };
/** 400 days, the longest cookie lifetime browsers honor. */
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/** GET /api/wall: the summary for an enrolled display or the hub's bearer token. */
export function handleWallRequest(
  db: Db,
  request: Request,
  now: Date = new Date(),
): Response {
  const ok = isAuthorizedDisplay(db, {
    authorization: request.headers.get("authorization"),
    cookie: request.headers.get("cookie"),
  });
  if (!ok)
    return Response.json(
      { ok: false, error: NOT_ENROLLED },
      { status: 401, headers: NO_STORE },
    );
  return Response.json(loadWallSummary(db, now), { headers: NO_STORE });
}

/** GET /wall/enroll?token=…: set the device cookie once, then land on /wall. A bad token lands there unenrolled. */
export function handleEnroll(db: Db, request: Request): Response {
  const url = new URL(request.url);
  const origin = requestOrigin({ url: request.url, headers: request.headers });
  const target = `${origin}/wall`;
  const token = url.searchParams.get("token");
  if (!verifyToken(db, token))
    return new Response(null, {
      status: 303,
      headers: { Location: target, ...NO_STORE },
    });
  const secure = origin.startsWith("https://");
  const cookie = [
    `${DEVICE_COOKIE}=${encodeURIComponent(token as string)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
  return new Response(null, {
    status: 303,
    headers: { Location: target, "Set-Cookie": cookie, ...NO_STORE },
  });
}
