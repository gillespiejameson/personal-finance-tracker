import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openDb } from "@/lib/db/client";
import { handleEnroll, handleWallRequest } from "@/lib/wall/http";
import { storeToken } from "@/lib/wall/token";

const summarySchema = z.object({
  generatedAt: z.string(),
  today: z.string(),
  gateOpen: z.boolean(),
  safeToSpend: z
    .object({
      perDayCents: z.number(),
      totalCents: z.number(),
      untilDate: z.string(),
      horizonLabel: z.string(),
    })
    .nullable(),
  bills: z.object({
    due: z.array(
      z.object({
        name: z.string(),
        cents: z.number(),
        expectedDate: z.string(),
        overdue: z.boolean(),
        categoryColor: z.string().nullable(),
      }),
    ),
    dueTotalCents: z.number(),
  }),
  review: z.object({
    count: z.number(),
    streakWeeks: z.number(),
    weeklyDue: z.boolean(),
  }),
  budget: z
    .object({
      month: z.string(),
      spentCents: z.number(),
      budgetedCents: z.number(),
      elapsedShare: z.number(),
    })
    .nullable(),
  nextPlanned: z
    .object({ name: z.string(), cents: z.number(), date: z.string() })
    .nullable(),
  alerts: z.object({ count: z.number() }),
});
const req = (headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/wall", { headers });

describe("handleWallRequest", () => {
  it("rejects anonymous and wrong tokens with 401 JSON", async () => {
    const db = openDb(":memory:");
    storeToken(db, "good", new Date());
    for (const r of [
      req(),
      req({ authorization: "Bearer bad" }),
      req({ cookie: "wall_device=bad" }),
      req({ cookie: "wall_device=%" }),
    ]) {
      const res = handleWallRequest(db, r);
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: false, error: "Not enrolled." });
    }
  });
  it("returns the summary for a bearer header or the cookie", async () => {
    const db = openDb(":memory:");
    storeToken(db, "good", new Date());
    for (const r of [
      req({ authorization: "Bearer good" }),
      req({ cookie: "wall_device=good" }),
    ]) {
      const res = handleWallRequest(db, r, new Date("2026-09-10T12:00:00Z"));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = summarySchema.parse(await res.json());
      expect(body.generatedAt).toBe("2026-09-10T12:00:00.000Z");
    }
  });
});

describe("handleEnroll", () => {
  it("sets the device cookie and redirects to /wall for a valid token", () => {
    const db = openDb(":memory:");
    storeToken(db, "good", new Date());
    const res = handleEnroll(
      db,
      new Request("https://finance.example.test/wall/enroll?token=good"),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://finance.example.test/wall",
    );
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("wall_device=good");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=34560000");
    expect(cookie).toContain("Secure");
  });
  it("marks the cookie Secure behind a forwarding proxy and not on plain http", () => {
    const db = openDb(":memory:");
    storeToken(db, "good", new Date());
    const proxied = handleEnroll(
      db,
      new Request("http://localhost:3000/wall/enroll?token=good", {
        headers: {
          "x-forwarded-host": "finance.example.test",
          "x-forwarded-proto": "https",
        },
      }),
    );
    expect(proxied.headers.get("set-cookie")).toContain("Secure");
    expect(proxied.headers.get("location")).toBe(
      "https://finance.example.test/wall",
    );
    const plain = handleEnroll(
      db,
      new Request("http://192.168.1.20:3000/wall/enroll?token=good"),
    );
    expect(plain.headers.get("set-cookie")).not.toContain("Secure");
    expect(plain.headers.get("location")).toBe("http://192.168.1.20:3000/wall");
  });
  it("redirects without a cookie for a bad or missing token", () => {
    const db = openDb(":memory:");
    storeToken(db, "good", new Date());
    for (const u of [
      "http://localhost:3000/wall/enroll?token=bad",
      "http://localhost:3000/wall/enroll",
    ]) {
      const res = handleEnroll(db, new Request(u));
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("http://localhost:3000/wall");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });
});
