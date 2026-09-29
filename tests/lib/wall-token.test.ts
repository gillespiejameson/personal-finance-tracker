import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import {
  clearToken,
  generateToken,
  hashToken,
  storeToken,
  TOKEN_CREATED_KEY,
  TOKEN_HASH_KEY,
  tokenInfo,
  verifyToken,
} from "@/lib/wall/token";

describe("wall token", () => {
  it("generates 43-char base64url tokens that differ", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  it("hashes stably", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toHaveLength(64);
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
  it("verifies only the stored token", () => {
    const db = openDb(":memory:");
    expect(tokenInfo(db)).toEqual({ set: false, createdAt: null });
    expect(verifyToken(db, "anything")).toBe(false);
    storeToken(db, "tok_fixed_value", new Date("2026-09-07T20:00:00Z"));
    expect(tokenInfo(db)).toEqual({
      set: true,
      createdAt: "2026-09-07T20:00:00.000Z",
    });
    expect(verifyToken(db, "tok_fixed_value")).toBe(true);
    expect(verifyToken(db, "tok_fixed_valuf")).toBe(false);
    expect(verifyToken(db, "")).toBe(false);
    expect(verifyToken(db, null)).toBe(false);
  });
  it("stores hash and timestamp together, never a half-written pair", () => {
    const db = openDb(":memory:");
    storeToken(db, "tok", new Date("2026-09-08T10:00:00Z"));
    const rows = db
      .select()
      .from(settings)
      .where(inArray(settings.key, [TOKEN_HASH_KEY, TOKEN_CREATED_KEY]))
      .all();
    expect(rows).toHaveLength(2);
    expect(tokenInfo(db).createdAt).not.toBeNull();
  });
  it("rotation invalidates the old token and clearing revokes all", () => {
    const db = openDb(":memory:");
    storeToken(db, "one", new Date());
    storeToken(db, "two", new Date());
    expect(verifyToken(db, "one")).toBe(false);
    expect(verifyToken(db, "two")).toBe(true);
    clearToken(db);
    expect(verifyToken(db, "two")).toBe(false);
    expect(tokenInfo(db)).toEqual({ set: false, createdAt: null });
  });
});
