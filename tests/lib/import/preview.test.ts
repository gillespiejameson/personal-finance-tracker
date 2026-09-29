import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPreview } from "@/lib/import/preview";
import { BUILTIN_PROFILES } from "@/lib/import/profiles";

const read = (f: string) => fs.readFileSync(`tests/fixtures/${f}`, "utf8");

describe("buildPreview", () => {
  it("refuses PDF statements with a helpful message", () => {
    expect(() =>
      buildPreview("fnb june.PDF", "%PDF-1.7\n%âã\n38 0 obj", BUILTIN_PROFILES),
    ).toThrow(/PDF statements aren't supported/);
    expect(() =>
      buildPreview("statement.csv", "%PDF-1.4 garbage", BUILTIN_PROFILES),
    ).toThrow(/PDF/);
  });
  it("detects Chase and normalizes rows", () => {
    const p = buildPreview("chase.csv", read("chase.csv"), BUILTIN_PROFILES);
    expect(p.detectedProfile).toBe(true);
    expect(p.rows).toHaveLength(3);
    expect(p.outflowCheck).toEqual({ negativeCount: 2, positiveCount: 1 });
  });
  it("unknown headers → no profile, rows empty, headers kept for the wizard", () => {
    const p = buildPreview("x.csv", read("unknown.csv"), BUILTIN_PROFILES);
    expect(p.profile).toBeNull();
    expect(p.headers).toEqual(["When", "What", "Out", "In"]);
    expect(p.rows).toHaveLength(0);
  });
  it("wizard override maps unknown file, infers DMY", () => {
    const p = buildPreview("x.csv", read("unknown.csv"), BUILTIN_PROFILES, {
      name: "My CU",
      dateCol: "When",
      descCol: "What",
      debitCol: "Out",
      creditCol: "In",
      signConvention: "debit_credit_cols",
    });
    expect(p.dateFormat).toEqual({ format: "DMY", ambiguous: false });
    expect(p.rows.map((r) => r.date)).toEqual(["2026-03-31", "2026-04-01"]);
    expect(p.rows.map((r) => r.amountCents)).toEqual([-1250, 150000]);
  });
  it("headerless csv gets synthetic columns", () => {
    const p = buildPreview(
      "wf.csv",
      `"03/02/2026","-6.75","*","","SQ *BLUE BOTTLE"\n`,
      BUILTIN_PROFILES,
    );
    expect(p.headerless).toBe(true);
    expect(p.headers).toEqual(["col1", "col2", "col3", "col4", "col5"]);
    expect(p.profile?.name).toBe("Wells Fargo (headerless)");
    expect(p.rows[0]).toMatchObject({ date: "2026-03-02", amountCents: -675 });
  });
  it("skipRows applies before headerless detection and re-parse", () => {
    const text = `Statement for account 1234\n"03/02/2026","-6.75","*","","SQ *BLUE BOTTLE"\n`;
    const p = buildPreview("wf.csv", text, BUILTIN_PROFILES, { skipRows: 1 });
    expect(p.headerless).toBe(true);
    expect(p.profile?.name).toBe("Wells Fargo (headerless)");
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ date: "2026-03-02", amountCents: -675 });
  });
  it("routes ofx", () => {
    const p = buildPreview("s.qfx", read("sample.ofx"), BUILTIN_PROFILES);
    expect(p.kind).toBe("ofx");
    expect(p.rows).toHaveLength(3);
  });
});
