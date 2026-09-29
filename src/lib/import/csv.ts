import Papa from "papaparse";
import type { RawRow } from "./types";

export function parseCsv(
  text: string,
  skipRows = 0,
): { headers: string[]; rows: RawRow[] } {
  const body =
    skipRows > 0 ? text.split(/\r?\n/).slice(skipRows).join("\n") : text;
  const noBom = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body; // strip UTF-8 BOM
  const result = Papa.parse<RawRow>(noBom, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const headers = result.meta.fields ?? [];
  const rows = result.data.filter((r) =>
    Object.values(r).some((v) => (v ?? "").trim() !== ""),
  );
  return { headers, rows };
}
