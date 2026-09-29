import { describe, expect, it } from "vitest";
import { centsToDecimal, csvField, csvText, toCsv } from "@/lib/export/csv";

describe("csvField", () => {
  it("quotes a field containing a comma", () => {
    expect(csvField("a,b")).toBe('"a,b"');
  });

  it("doubles embedded quotes and wraps the field", () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a field containing a newline", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("quotes a field containing a carriage return", () => {
    expect(csvField("a\rb")).toBe('"a\rb"');
  });

  it("leaves a plain field unchanged", () => {
    expect(csvField("plain text")).toBe("plain text");
  });
});

describe("csvText", () => {
  it("prefixes a leading equals sign to block formula injection", () => {
    expect(csvText("=SUM(A1)")).toBe("'=SUM(A1)");
  });

  it("prefixes a leading plus sign", () => {
    expect(csvText("+1")).toBe("'+1");
  });

  it("prefixes a leading minus sign, even for a value shaped like a number", () => {
    expect(csvText("-5.00")).toBe("'-5.00");
  });

  it("prefixes a leading at sign", () => {
    expect(csvText("@mention")).toBe("'@mention");
  });

  it("prefixes a leading tab", () => {
    expect(csvText("\tx")).toBe("'\tx");
  });

  it("prefixes a leading carriage return", () => {
    expect(csvText("\rx")).toBe("'\rx");
  });

  it("leaves a plain value unchanged", () => {
    expect(csvText("Kroger")).toBe("Kroger");
  });
});

describe("toCsv", () => {
  it("joins header and rows with CRLF, header first, trailing CRLF", () => {
    const out = toCsv(
      ["a", "b"],
      [
        ["1", "2"],
        ["3", "4"],
      ],
    );
    expect(out).toBe("a,b\r\n1,2\r\n3,4\r\n");
  });

  it("quotes fields within rows as needed", () => {
    const out = toCsv(["h"], [["has,comma"]]);
    expect(out).toBe('h\r\n"has,comma"\r\n');
  });
});

describe("centsToDecimal", () => {
  it("formats negative cents", () => {
    expect(centsToDecimal(-4210)).toBe("-42.10");
  });

  it("formats small positive cents under a dollar", () => {
    expect(centsToDecimal(5)).toBe("0.05");
  });

  it("formats small negative cents under a dollar", () => {
    expect(centsToDecimal(-5)).toBe("-0.05");
  });

  it("formats zero", () => {
    expect(centsToDecimal(0)).toBe("0.00");
  });

  it("formats larger amounts", () => {
    expect(centsToDecimal(123456)).toBe("1234.56");
  });

  it("throws for a non-integer amount", () => {
    expect(() => centsToDecimal(12.5)).toThrow(TypeError);
    expect(() => centsToDecimal(12.5)).toThrow("cents must be an integer");
  });
});
