const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * SimpleFIN URLs must be `https:`; plain `http:` is tolerated only for a
 * loopback host so a local stub can stand in for the bridge during testing.
 */
export function isAllowedSfinUrl(u: URL): boolean {
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname);
}

export function parseSfinUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  return isAllowedSfinUrl(u) ? u : null;
}

/** A setup token is the base64 of a claim URL. */
export function decodeSetupToken(
  token: string,
): { ok: true; claimUrl: string } | { ok: false; error: string } {
  const t = token.trim();
  if (!t) return { ok: false, error: "Paste a setup token." };
  if (!/^[A-Za-z0-9+/\-_]+=*$/.test(t.replace(/\s+/g, "")))
    return { ok: false, error: "That doesn't look like a setup token." };
  const decoded = Buffer.from(t.replace(/\s+/g, ""), "base64")
    .toString("utf8")
    .trim();
  const u = parseSfinUrl(decoded);
  if (!u || u.username || u.password)
    return {
      ok: false,
      error: "That doesn't look like a setup token.",
    };
  return { ok: true, claimUrl: u.toString() };
}
