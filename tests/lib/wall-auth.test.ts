import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import {
  bearerFrom,
  cookieValue,
  isAuthorizedDisplay,
  presentedToken,
} from "@/lib/wall/auth";
import { storeToken } from "@/lib/wall/token";

describe("display auth parsing", () => {
  it("reads a bearer token", () => {
    expect(bearerFrom("Bearer abc")).toBe("abc");
    expect(bearerFrom("bearer abc")).toBe("abc");
    expect(bearerFrom("Basic abc")).toBeNull();
    expect(bearerFrom(null)).toBeNull();
    expect(bearerFrom("Bearer ")).toBeNull();
  });
  it("reads one cookie out of a header", () => {
    expect(cookieValue("a=1; wall_device=tok%3D; b=2", "wall_device")).toBe(
      "tok=",
    );
    expect(cookieValue("a=1", "wall_device")).toBeNull();
    expect(cookieValue(null, "wall_device")).toBeNull();
    expect(cookieValue("wall_device=%", "wall_device")).toBeNull();
  });
  it("prefers the header over the cookie", () => {
    expect(
      presentedToken({ authorization: "Bearer h", cookie: "wall_device=c" }),
    ).toBe("h");
    expect(
      presentedToken({ authorization: null, cookie: "wall_device=c" }),
    ).toBe("c");
    expect(presentedToken({ authorization: null, cookie: null })).toBeNull();
  });
});

describe("isAuthorizedDisplay", () => {
  it("accepts the stored token by header or cookie and nothing else", () => {
    const db = openDb(":memory:");
    storeToken(db, "good", new Date());
    expect(
      isAuthorizedDisplay(db, { authorization: "Bearer good", cookie: null }),
    ).toBe(true);
    expect(
      isAuthorizedDisplay(db, {
        authorization: null,
        cookie: "wall_device=good",
      }),
    ).toBe(true);
    expect(
      isAuthorizedDisplay(db, {
        authorization: "Bearer bad",
        cookie: "wall_device=good",
      }),
    ).toBe(false);
    expect(isAuthorizedDisplay(db, { authorization: null, cookie: null })).toBe(
      false,
    );
  });
});
