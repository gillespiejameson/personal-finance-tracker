"use client";
import { useState } from "react";
import type { ProfileOverride } from "@/actions/imports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RawRow } from "@/lib/import/types";

type Props = {
  headers: string[];
  sample: RawRow[];
  initial?: ProfileOverride;
  onApply: (o: ProfileOverride) => void;
};

const Select = ({
  label,
  value,
  onChange,
  headers,
  allowNone,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  headers: string[];
  allowNone?: boolean;
}) => (
  <label className="grid gap-1 text-caption text-ink-2">
    {label}
    <select
      className="h-9 rounded-control border border-line bg-card px-3 text-body text-ink"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      {allowNone && <option value="">—</option>}
      {headers.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </select>
  </label>
);

export function MappingWizard({ headers, sample, initial, onApply }: Props) {
  const [o, setO] = useState<ProfileOverride>(
    initial ?? {
      name: "",
      dateCol: headers[0],
      descCol: headers[1] ?? headers[0],
      amountCol: headers[2] ?? null,
      signConvention: "outflow_negative",
      dateFormat: "MDY",
      skipRows: 0,
    },
  );
  const set = <K extends keyof ProfileOverride>(k: K, v: ProfileOverride[K]) =>
    setO({ ...o, [k]: v });
  const dc = o.signConvention === "debit_credit_cols";
  return (
    <div className="grid gap-5">
      <p className="text-body text-ink-2">
        We don't recognize this bank yet. Tell us which column is which and
        we'll remember it.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <label
          htmlFor="profile-name"
          className="col-span-2 grid gap-1 text-caption text-ink-2"
        >
          Profile name
          <Input
            id="profile-name"
            value={o.name ?? ""}
            onChange={(e) => set("name", e.target.value)}
            placeholder="My Credit Union"
          />
        </label>
        <Select
          label="Date column"
          value={o.dateCol}
          onChange={(v) => set("dateCol", v ?? undefined)}
          headers={headers}
        />
        <Select
          label="Description column"
          value={o.descCol}
          onChange={(v) => set("descCol", v ?? undefined)}
          headers={headers}
        />
        <label className="grid gap-1 text-caption text-ink-2">
          Amount layout
          <select
            className="h-9 rounded-control border border-line bg-card px-3 text-body text-ink"
            value={o.signConvention}
            onChange={(e) =>
              set(
                "signConvention",
                e.target.value as ProfileOverride["signConvention"],
              )
            }
          >
            <option value="outflow_negative">
              One column, purchases negative
            </option>
            <option value="outflow_positive">
              One column, purchases positive
            </option>
            <option value="debit_credit_cols">
              Separate debit and credit columns
            </option>
          </select>
        </label>
        <label className="grid gap-1 text-caption text-ink-2">
          Date format
          <select
            className="h-9 rounded-control border border-line bg-card px-3 text-body text-ink"
            value={o.dateFormat}
            onChange={(e) =>
              set("dateFormat", e.target.value as ProfileOverride["dateFormat"])
            }
          >
            <option value="MDY">Month / Day / Year</option>
            <option value="DMY">Day / Month / Year</option>
            <option value="YMD">Year - Month - Day</option>
          </select>
        </label>
        {!dc && (
          <Select
            label="Amount column"
            value={o.amountCol}
            onChange={(v) => set("amountCol", v)}
            headers={headers}
          />
        )}
        {dc && (
          <Select
            label="Debit (money out)"
            value={o.debitCol}
            onChange={(v) => set("debitCol", v)}
            headers={headers}
          />
        )}
        {dc && (
          <Select
            label="Credit (money in)"
            value={o.creditCol}
            onChange={(v) => set("creditCol", v)}
            headers={headers}
          />
        )}
        <Select
          label="Balance column (optional)"
          value={o.balanceCol}
          onChange={(v) => set("balanceCol", v)}
          headers={headers}
          allowNone
        />
        <label
          htmlFor="skip-rows"
          className="grid gap-1 text-caption text-ink-2"
        >
          Rows to skip before the header
          <Input
            id="skip-rows"
            type="number"
            min={0}
            step={1}
            value={String(o.skipRows ?? 0)}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              set("skipRows", Number.isFinite(n) && n > 0 ? n : 0);
            }}
          />
        </label>
      </div>
      <div className="overflow-x-auto rounded-control border border-line">
        <table className="w-full text-caption">
          <thead className="bg-subtle text-ink-2">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sample.slice(0, 5).map((r, i) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: raw sample rows of a file, read-only and never reordered; they have no id
                key={`${r[headers[0]]}-${i}`}
                className="border-t border-line"
              >
                {headers.map((h) => (
                  <td key={h} className="px-3 py-2 tnum">
                    {r[h]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        onClick={() => onApply(o)}
        disabled={!o.name || !o.dateCol || !o.descCol}
      >
        Apply mapping
      </Button>
    </div>
  );
}
