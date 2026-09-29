import Papa from "papaparse";
import type { DateFormat } from "@/lib/dates";
import { parseCsv } from "./csv";
import { detectDateFormat, detectProfile } from "./detect";
import { normalizeRow } from "./normalizeRow";
import { parseOfx } from "./ofx";
import { headerSignature } from "./profiles";
import type { BankProfile, ParsedRow, RawRow, RowError } from "./types";

export type PreviewResult = {
  kind: "csv" | "ofx";
  headers: string[];
  profile: BankProfile | null;
  detectedProfile: boolean;
  dateFormat: { format: DateFormat; ambiguous: boolean };
  rows: ParsedRow[];
  errors: RowError[];
  sampleRaw: RawRow[];
  headerless: boolean;
  outflowCheck: { negativeCount: number; positiveCount: number };
};

const looksLikeDate = (s: string) =>
  /^\s*"?\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}"?\s*$/.test(s) ||
  /^\s*"?\d{8}"?\s*$/.test(s);

export function isOfx(filename: string, text: string): boolean {
  return (
    /\.(ofx|qfx)$/i.test(filename) ||
    /^\s*(OFXHEADER|<\?xml[^>]*>\s*<\?OFX|<OFX>)/i.test(text)
  );
}

/** PDF statements are not parsed in Phase 1; refuse them with a helpful message. */
export function isPdf(filename: string, text: string): boolean {
  return /\.pdf$/i.test(filename) || text.startsWith("%PDF");
}

export const PDF_MESSAGE =
  "PDF statements aren't supported yet. Export the account activity as CSV or QFX from your bank's website and drop that here.";

function outflowCheck(rows: ParsedRow[]) {
  return {
    negativeCount: rows.filter((r) => r.amountCents < 0).length,
    positiveCount: rows.filter((r) => r.amountCents > 0).length,
  };
}

export function buildPreview(
  filename: string,
  text: string,
  profiles: BankProfile[],
  override?: Partial<BankProfile>,
): PreviewResult {
  if (isPdf(filename, text)) throw new Error(PDF_MESSAGE);
  if (isOfx(filename, text)) {
    const { rows } = parseOfx(text);
    return {
      kind: "ofx",
      headers: [],
      profile: null,
      detectedProfile: true,
      dateFormat: { format: "YMD", ambiguous: false },
      rows,
      errors: [],
      sampleRaw: [],
      headerless: false,
      outflowCheck: outflowCheck(rows),
    };
  }

  const skip = override?.skipRows ?? 0;
  const body = skip > 0 ? text.split(/\r?\n/).slice(skip).join("\n") : text;
  const firstLine = body.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const firstCell = firstLine.split(",")[0] ?? "";
  const headerless = looksLikeDate(firstCell);
  let parsed = parseCsv(body);
  if (headerless) {
    const n = (Papa.parse<string[]>(firstLine, { header: false }).data[0] ?? [])
      .length;
    const cols = Array.from({ length: n }, (_, i) => `col${i + 1}`);
    parsed = parseCsv(`${cols.join(",")}\n${body}`);
  }
  const { headers, rows: raw } = parsed;

  const detected = detectProfile(headers, profiles);
  let profile: BankProfile | null = detected;
  if (override && (override.dateCol || detected)) {
    const base: BankProfile = detected ?? {
      name: override.name ?? filename,
      headerSignature: headerSignature(headers),
      dateCol: "",
      descCol: "",
      amountCol: null,
      debitCol: null,
      creditCol: null,
      balanceCol: null,
      dateFormat: "MDY",
      signConvention: "outflow_negative",
      skipRows: 0,
      builtin: false,
    };
    profile = {
      ...base,
      ...override,
      headerSignature: headerSignature(headers),
      builtin: false,
    };
  }

  if (!profile || !profile.dateCol) {
    return {
      kind: "csv",
      headers,
      profile: null,
      detectedProfile: false,
      dateFormat: { format: "MDY", ambiguous: true },
      rows: [],
      errors: [],
      sampleRaw: raw.slice(0, 20),
      headerless,
      outflowCheck: { negativeCount: 0, positiveCount: 0 },
    };
  }

  const dateFormat =
    profile.builtin && !override?.dateFormat
      ? { format: profile.dateFormat, ambiguous: false }
      : override?.dateFormat
        ? { format: override.dateFormat, ambiguous: false }
        : detectDateFormat(raw.map((r) => r[profile.dateCol] ?? ""));
  const effective = { ...profile, dateFormat: dateFormat.format };

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  raw.forEach((r, i) => {
    const res = normalizeRow(r, effective, i);
    if (res.ok) rows.push(res.row);
    else errors.push(res.error);
  });

  return {
    kind: "csv",
    headers,
    profile: effective,
    detectedProfile: !!detected,
    dateFormat,
    rows,
    errors,
    sampleRaw: raw.slice(0, 20),
    headerless,
    outflowCheck: outflowCheck(rows),
  };
}
