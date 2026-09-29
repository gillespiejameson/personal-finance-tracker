"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb } from "@/lib/db/client";
import { requestOrigin } from "@/lib/wall/origin";
import {
  clearToken,
  generateToken,
  storeToken,
  tokenInfo,
} from "@/lib/wall/token";

/** Where this request came in: the tunnel hostname when proxied, else the LAN/localhost origin. */
async function currentOrigin(): Promise<string> {
  const h = await headers();
  return requestOrigin({
    url: `http://${h.get("host") ?? "localhost:3000"}`,
    headers: h,
  });
}

export async function getHouseholdAction(): Promise<{
  tokenSet: boolean;
  createdAt: string | null;
  origin: string;
}> {
  const info = tokenInfo(getDb());
  return {
    tokenSet: info.set,
    createdAt: info.createdAt,
    origin: await currentOrigin(),
  };
}

/** Generates (or rotates) the display token. The token is returned exactly once and never stored in clear. */
export async function generateWallTokenAction(): Promise<
  { ok: true; token: string; enrollUrl: string } | { ok: false; error: string }
> {
  const token = generateToken();
  storeToken(getDb(), token, new Date());
  revalidatePath("/settings");
  const origin = await currentOrigin();
  return {
    ok: true,
    token,
    enrollUrl: `${origin}/wall/enroll?token=${encodeURIComponent(token)}`,
  };
}

export async function revokeWallTokenAction(): Promise<{ ok: true }> {
  clearToken(getDb());
  revalidatePath("/settings");
  return { ok: true };
}
