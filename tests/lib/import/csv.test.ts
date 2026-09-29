import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/import/csv";

const read = (f: string) => fs.readFileSync(`tests/fixtures/${f}`, "utf8");

describe("parseCsv", () => {
  it("returns headers and keyed rows", () => {
    const { headers, rows } = parseCsv(read("chase.csv"));
    expect(headers[0]).toBe("Transaction Date");
    expect(rows).toHaveLength(3);
    expect(rows[0].Description).toContain("AMAZON");
  });
  it("skips leading rows and handles quoted commas", () => {
    const { rows } = parseCsv(`junk line\n${read("bofa.csv")}`, 1);
    expect(rows[0]["Running Bal."]).toBe("1,203.11");
  });
  it("drops fully empty rows", () => {
    expect(parseCsv("A,B\n1,2\n\n,\n").rows).toHaveLength(1);
  });
});
