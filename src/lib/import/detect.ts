import type { DateFormat } from "@/lib/dates";
import { headerSignature } from "./profiles";
import type { BankProfile } from "./types";

export function detectProfile(
  headers: string[],
  candidates: BankProfile[],
): BankProfile | null {
  const sig = headerSignature(headers);
  return candidates.find((p) => p.headerSignature === sig) ?? null;
}

export function detectDateFormat(samples: string[]): {
  format: DateFormat;
  ambiguous: boolean;
} {
  let firstOver12 = false;
  let secondOver12 = false;
  for (const raw of samples) {
    const s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{8}$/.test(s))
      return { format: "YMD", ambiguous: false };
    const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.]\d{2,4}$/.exec(s);
    if (!m) continue;
    if (+m[1] > 12) firstOver12 = true;
    if (+m[2] > 12) secondOver12 = true;
  }
  if (firstOver12 && !secondOver12) return { format: "DMY", ambiguous: false };
  if (secondOver12 && !firstOver12) return { format: "MDY", ambiguous: false };
  return { format: "MDY", ambiguous: true };
}
