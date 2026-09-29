import { parseAmountToCents } from "@/lib/money";
import { cleanMerchant } from "@/lib/normalize/merchant";
import type { ParsedRow } from "./types";

function tag(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block);
  return m?.[1].trim();
}

function ofxDate(s: string | undefined): string | null {
  if (!s || !/^\d{8}/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function parseOfx(text: string): {
  accountId?: string;
  rows: ParsedRow[];
} {
  const body = text.slice(text.search(/<OFX>/i));
  const accountId = tag(body, "ACCTID");
  const rows: ParsedRow[] = [];
  const re = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  for (const m of body.matchAll(re)) {
    const b = m[1];
    const date = ofxDate(tag(b, "DTPOSTED"));
    const amountCents = parseAmountToCents(tag(b, "TRNAMT") ?? "");
    const name = tag(b, "NAME") ?? tag(b, "PAYEE") ?? "";
    const memo = tag(b, "MEMO");
    if (!date || amountCents === null) continue;
    const rawDescription = [name, memo].filter(Boolean).join(" ").trim();
    rows.push({
      date,
      amountCents,
      rawDescription,
      merchant: cleanMerchant(name || rawDescription),
    });
  }
  return { accountId, rows };
}
