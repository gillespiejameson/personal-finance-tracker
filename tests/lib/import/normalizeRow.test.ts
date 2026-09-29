import { describe, expect, it } from "vitest";
import { normalizeRow } from "@/lib/import/normalizeRow";
import { BUILTIN_PROFILES } from "@/lib/import/profiles";
import { mustFind } from "../../helpers";

const by = (n: string) =>
  mustFind(BUILTIN_PROFILES, (p) => p.name === n, `the ${n} profile`);

describe("normalizeRow", () => {
  it("outflow_negative keeps sign", () => {
    const r = normalizeRow(
      {
        "Transaction Date": "03/14/2026",
        Description: "KROGER #1234",
        Amount: "-88.10",
      },
      by("Chase (card)"),
      0,
    );
    expect(r).toMatchObject({
      ok: true,
      row: { date: "2026-03-14", amountCents: -8810, merchant: "Kroger" },
    });
  });
  it("outflow_positive flips sign", () => {
    const r = normalizeRow(
      { Date: "03/04/2026", Description: "DOORDASH", Amount: "31.20" },
      by("American Express"),
      0,
    );
    expect(r).toMatchObject({ ok: true, row: { amountCents: -3120 } });
  });
  it("debit/credit columns", () => {
    const p = by("Capital One");
    expect(
      normalizeRow(
        {
          "Transaction Date": "2026-03-01",
          Description: "A",
          Debit: "12.00",
          Credit: "",
        },
        p,
        0,
      ),
    ).toMatchObject({ ok: true, row: { amountCents: -1200 } });
    expect(
      normalizeRow(
        {
          "Transaction Date": "2026-03-01",
          Description: "A",
          Debit: "",
          Credit: "50",
        },
        p,
        0,
      ),
    ).toMatchObject({ ok: true, row: { amountCents: 5000 } });
  });
  it("zero debit with empty credit is a zero-amount row, not an error", () => {
    const p = by("Capital One");
    expect(
      normalizeRow(
        {
          "Transaction Date": "2026-03-01",
          Description: "A",
          Debit: "0.00",
          Credit: "",
        },
        p,
        0,
      ),
    ).toMatchObject({ ok: true, row: { amountCents: 0 } });
    expect(
      normalizeRow(
        {
          "Transaction Date": "2026-03-01",
          Description: "A",
          Debit: "",
          Credit: "",
        },
        p,
        0,
      ),
    ).toMatchObject({ ok: false });
  });
  it("reports bad dates and amounts", () => {
    expect(
      normalizeRow(
        { "Transaction Date": "nope", Description: "A", Amount: "1" },
        by("Chase (card)"),
        4,
      ),
    ).toMatchObject({ ok: false, error: { rowIndex: 4 } });
    expect(
      normalizeRow(
        { "Transaction Date": "03/14/2026", Description: "A", Amount: "" },
        by("Chase (card)"),
        5,
      ),
    ).toMatchObject({ ok: false });
  });
});
