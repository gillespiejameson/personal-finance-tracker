import { describe, expect, it, vi } from "vitest";
import { ensureDefaultCategories } from "@/lib/categories/ensure";
import { type Db, openDb } from "@/lib/db/client";
import { CLAIM_USED_ERROR } from "@/lib/simplefin/client";
import {
  CONNECT_SAVE_ERROR,
  connectWithToken,
  DB_UNAVAILABLE_ERROR,
} from "@/lib/simplefin/connect";
import { getAccessUrl } from "@/lib/simplefin/store";

vi.mock("@/lib/simplefin/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/simplefin/store")>();
  return { ...actual, setAccessUrl: vi.fn(actual.setAccessUrl) };
});
const store = await import("@/lib/simplefin/store");

const NOW = new Date("2026-10-11T15:00:00Z");
const CLAIM = "https://sfin.test/simplefin/claim/abc";
const TOKEN = Buffer.from(CLAIM).toString("base64");
const ACCESS = "https://alice:s3cret@sfin.test/simplefin";

type Call = { url: string; init?: RequestInit };

/** Answers the claim with the access URL and `/accounts` with an empty payload. */
function bridge(claimStatus = 200): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === CLAIM)
      return claimStatus === 200
        ? new Response(ACCESS, { status: 200 })
        : new Response("", { status: claimStatus });
    return new Response(JSON.stringify({ errors: [], accounts: [] }), {
      status: 200,
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

function freshDb(): Db {
  const db = openDb(":memory:");
  ensureDefaultCategories(db);
  return db;
}

describe("connectWithToken", () => {
  it("claims the token, stores the access URL and runs the first sync", async () => {
    const db = freshDb();
    const { fetchFn, calls } = bridge();
    const out = await connectWithToken(() => db, fetchFn, TOKEN, NOW);
    expect(out).toMatchObject({ ok: true, sync: { ok: true } });
    expect(getAccessUrl(db)).toBe(ACCESS);
    expect(calls[0].url).toBe(CLAIM);
    expect(calls.length).toBeGreaterThan(1); // the sync followed the claim
  });

  it("opens the database before claiming, so a broken database leaves the token unused", async () => {
    const { fetchFn, calls } = bridge();
    const out = await connectWithToken(
      () => {
        throw new Error("SQLITE_CANTOPEN: unable to open database file");
      },
      fetchFn,
      TOKEN,
      NOW,
    );
    expect(out).toEqual({ ok: false, error: DB_UNAVAILABLE_ERROR });
    expect(calls).toHaveLength(0);
    expect(DB_UNAVAILABLE_ERROR).toMatch(/not used/);
  });

  it("checks the token's shape before touching the database or the network", async () => {
    const { fetchFn, calls } = bridge();
    const openDbSpy = vi.fn(freshDb);
    const out = await connectWithToken(
      openDbSpy,
      fetchFn,
      "not a token!!",
      NOW,
    );
    expect(out).toMatchObject({ ok: false });
    expect(openDbSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("passes SimpleFIN's refusal through without storing anything", async () => {
    const db = freshDb();
    const { fetchFn } = bridge(403);
    expect(await connectWithToken(() => db, fetchFn, TOKEN, NOW)).toEqual({
      ok: false,
      error: CLAIM_USED_ERROR,
    });
    expect(getAccessUrl(db)).toBeNull();
  });

  it("says the token is spent when saving fails after SimpleFIN accepted it", async () => {
    const db = freshDb();
    const { fetchFn } = bridge();
    vi.mocked(store.setAccessUrl).mockImplementationOnce(() => {
      throw new Error("SQLITE_READONLY: attempt to write a readonly database");
    });
    const out = await connectWithToken(() => db, fetchFn, TOKEN, NOW);
    expect(out).toEqual({ ok: false, error: CONNECT_SAVE_ERROR });
    expect(CONNECT_SAVE_ERROR).toMatch(/new setup token/);
    // The exception's text (which could name a path or the URL) never escapes.
    expect(JSON.stringify(out)).not.toContain("SQLITE");
    expect(JSON.stringify(out)).not.toContain("s3cret");
  });
});

describe("CLAIM_USED_ERROR", () => {
  it("names both reasons SimpleFIN refuses a setup token", () => {
    expect(CLAIM_USED_ERROR).toMatch(/only once/);
    expect(CLAIM_USED_ERROR).toMatch(/VPN/);
  });
});
