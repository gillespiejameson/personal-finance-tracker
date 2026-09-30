"use client";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { AmountText } from "@/components/finance/AmountText";
import { Button } from "@/components/ui/button";
import type { PreviewResult } from "@/lib/import/preview";

type Account = { id: number; name: string; type: string; color: string };
type Props = {
  preview: PreviewResult;
  accounts: Account[];
  accountId: number | null;
  onAccount: (id: number) => void;
  onFlipSign: () => void;
  onDateFormat: (f: "MDY" | "DMY" | "YMD") => void;
  onRemap: () => void;
  onCommit: () => void;
  committing: boolean;
};

export function ImportPreview({
  preview,
  accounts,
  accountId,
  onAccount,
  onFlipSign,
  onDateFormat,
  onRemap,
  onCommit,
  committing,
}: Props) {
  const {
    rows,
    errors,
    outflowCheck,
    dateFormat,
    detectedProfile,
    profile,
    kind,
  } = preview;
  const suspicious =
    kind === "csv" && outflowCheck.positiveCount > outflowCheck.negativeCount;
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2 text-body">
        {detectedProfile ? (
          <CheckCircle2 className="size-5 text-positive" />
        ) : (
          <AlertTriangle className="size-5 text-warning" />
        )}
        <span>
          {kind === "ofx"
            ? "OFX statement"
            : profile
              ? `Recognized as ${profile.name}`
              : "Custom mapping"}{" "}
          · {rows.length} rows
          {errors.length ? ` · ${errors.length} skipped` : ""}
        </span>
        {kind === "csv" && (
          <Button variant="ghost" size="sm" onClick={onRemap}>
            Change mapping
          </Button>
        )}
      </div>

      {suspicious && (
        <div className="flex items-center gap-3 rounded-control bg-warning/10 p-3 text-caption">
          <AlertTriangle className="size-4 text-warning" />
          Most rows look like money in. If these are mostly purchases, the sign
          is flipped.
          <Button size="sm" variant="outline" onClick={onFlipSign}>
            Flip signs
          </Button>
        </div>
      )}
      {dateFormat.ambiguous && (
        <div className="flex items-center gap-3 rounded-control bg-warning/10 p-3 text-caption">
          <AlertTriangle className="size-4 text-warning" />
          Dates could be month/day or day/month. We assumed{" "}
          <b>{dateFormat.format === "MDY" ? "month/day" : "day/month"}</b>.
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onDateFormat(dateFormat.format === "MDY" ? "DMY" : "MDY")
            }
          >
            Switch
          </Button>
        </div>
      )}

      <div className="max-h-80 overflow-auto rounded-control border border-line">
        <table className="w-full text-caption">
          <thead className="sticky top-0 bg-subtle text-ink-2">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a read-only preview of parsed rows, never reordered; identical rows are legal, so position is the identity
              <tr key={`${r.date}-${i}`} className="border-t border-line">
                <td className="px-3 py-2 tnum">{r.date}</td>
                <td className="px-3 py-2">
                  {r.merchant}
                  <span className="ml-2 text-ink-3">{r.rawDescription}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  <AmountText cents={r.amountCents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-end gap-4">
        <label className="grid flex-1 gap-1 text-caption text-ink-2">
          Import into
          <select
            className="h-10 rounded-control border border-line bg-card px-3 text-body text-ink"
            value={accountId ?? ""}
            onChange={(e) => onAccount(Number(e.target.value))}
          >
            <option value="" disabled>
              Choose an account
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.type}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="lg"
          onClick={onCommit}
          disabled={!accountId || rows.length === 0 || committing}
        >
          {committing ? "Importing…" : `Import ${rows.length} rows`}
        </Button>
      </div>
    </div>
  );
}
