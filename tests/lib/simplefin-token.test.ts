import { describe, expect, it } from "vitest";
import { decodeSetupToken, parseSfinUrl } from "@/lib/simplefin/token";

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("decodeSetupToken", () => {
  it("decodes a base64 https claim URL", () => {
    expect(
      decodeSetupToken(b64("https://bridge.simplefin.org/simplefin/claim/abc")),
    ).toEqual({
      ok: true,
      claimUrl: "https://bridge.simplefin.org/simplefin/claim/abc",
    });
  });

  it("tolerates surrounding whitespace and line breaks inside the token", () => {
    const t = b64("https://bridge.simplefin.org/simplefin/claim/abc");
    const wrapped = `  ${t.slice(0, 10)}\n${t.slice(10)}  `;
    expect(decodeSetupToken(wrapped)).toMatchObject({ ok: true });
  });

  it("rejects blanks, non-base64 and non-URL contents", () => {
    expect(decodeSetupToken("")).toEqual({
      ok: false,
      error: "Paste a setup token.",
    });
    expect(decodeSetupToken("not base64!!")).toMatchObject({ ok: false });
    expect(decodeSetupToken(b64("hello world"))).toMatchObject({ ok: false });
  });

  it("allows http only for loopback hosts", () => {
    expect(
      decodeSetupToken(b64("http://bridge.simplefin.org/claim")),
    ).toMatchObject({ ok: false });
    expect(decodeSetupToken(b64("http://127.0.0.1:3999/claim/x"))).toEqual({
      ok: true,
      claimUrl: "http://127.0.0.1:3999/claim/x",
    });
    expect(
      decodeSetupToken(b64("http://localhost:3999/claim/x")),
    ).toMatchObject({ ok: true });
  });

  it("rejects a claim URL that already carries credentials", () => {
    expect(
      decodeSetupToken(b64("https://u:p@bridge.simplefin.org/claim")),
    ).toMatchObject({ ok: false });
  });
});

describe("parseSfinUrl", () => {
  it("returns a URL for https and loopback http, null otherwise", () => {
    expect(
      parseSfinUrl("https://u:p@bridge.simplefin.org/simplefin")?.host,
    ).toBe("bridge.simplefin.org");
    expect(parseSfinUrl("http://u:p@localhost:1/simplefin")).not.toBeNull();
    expect(parseSfinUrl("http://u:p@example.com/simplefin")).toBeNull();
    expect(parseSfinUrl("ftp://bridge.simplefin.org/x")).toBeNull();
    expect(parseSfinUrl("nope")).toBeNull();
  });
});
