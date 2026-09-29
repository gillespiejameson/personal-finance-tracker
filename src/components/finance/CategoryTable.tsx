"use client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AmountText } from "@/components/finance/AmountText";
import type { CategoryRow } from "@/lib/insights/aggregate";
import { shiftMonth } from "@/lib/insights/page";
import {
  groupTransactionsHref,
  leafTransactionsHref,
} from "@/lib/transactions/links";
import { cn } from "@/lib/utils";

/** DOM id of a group row, so the donut can scroll it into view. */
export function categoryRowId(key: number | "uncategorized"): string {
  return `cat-${key}`;
}

const GRID = "grid-cols-[1fr_120px_120px_120px_70px]";
const LINK = "rounded-sm hover:text-accent hover:underline";

function AmountCell({
  cents,
  href,
  muted = false,
}: {
  cents: number;
  href: string | null;
  muted?: boolean;
}) {
  const amount = (
    <AmountText
      cents={cents}
      sign="never"
      colorize={false}
      className={cn(muted && "text-ink-2")}
    />
  );
  return (
    <span className="text-right">
      {href ? (
        <Link href={href} className={LINK}>
          {amount}
        </Link>
      ) : (
        amount
      )}
    </span>
  );
}

export function CategoryTable({
  rows,
  month,
  open: openProp,
  onToggle,
  highlight = null,
}: {
  rows: CategoryRow[];
  month: string;
  /** Names of the expanded groups. Omit for an uncontrolled table. */
  open?: Set<string>;
  onToggle?: (name: string) => void;
  /** Group whose row gets a subtle background (donut hover). */
  highlight?: string | null;
}) {
  const [openState, setOpenState] = useState<Set<string>>(new Set());
  const open = openProp ?? openState;
  const toggle = (n: string) => {
    if (onToggle) {
      onToggle(n);
      return;
    }
    setOpenState((s) => {
      const next = new Set(s);
      if (next.has(n)) {
        next.delete(n);
      } else {
        next.add(n);
      }
      return next;
    });
  };
  const lastMonth = shiftMonth(month, -1);
  const avgMonths = rows[0]?.avgMonths ?? 0;
  const hasAvg = avgMonths > 0;
  const avgLabel = hasAvg ? `Avg (${avgMonths} mo)` : "Avg (no full months)";
  return (
    <div className="overflow-hidden rounded-card bg-card shadow-card">
      <div
        className={cn(
          "grid gap-3 border-b border-line px-5 py-3 text-caption font-medium text-ink-2",
          GRID,
        )}
      >
        <span>Category</span>
        <span className="text-right">This month</span>
        <span className="text-right">Last month</span>
        <span className="text-right">{avgLabel}</span>
        <span className="text-right">Share</span>
      </div>
      {rows.map((r) => {
        const expandable = (r.leaves?.length ?? 0) > 0;
        const isOpen = open.has(r.name);
        const rowId = categoryRowId(r.id ?? "uncategorized");
        const groupHref = (m: string) =>
          r.id === null ? null : groupTransactionsHref(r.id, m);
        const nameContent = (
          <>
            <ChevronRight
              className={cn(
                "size-4 text-ink-3 transition-transform",
                isOpen && "rotate-90",
                !expandable && "invisible",
              )}
            />
            <span
              className="size-2.5 rounded-pill"
              style={{ backgroundColor: r.color }}
            />
            {r.name}
          </>
        );
        return (
          <div key={r.name}>
            <div
              id={rowId}
              className={cn(
                "grid items-center gap-3 border-b border-line px-5 py-3 transition-colors",
                GRID,
                highlight === r.name ? "bg-subtle" : "hover:bg-subtle/60",
              )}
            >
              <span className="flex items-center gap-2 text-body font-medium">
                {expandable ? (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`${rowId}-leaves`}
                    onClick={() => toggle(r.name)}
                    className="-my-1 -ml-1 flex flex-1 items-center gap-2 rounded-control py-1 pl-1 text-left"
                  >
                    {nameContent}
                  </button>
                ) : (
                  <span className="flex items-center gap-2">{nameContent}</span>
                )}
                {r.id === null && (
                  <Link href="/review" className="text-caption text-accent">
                    review
                  </Link>
                )}
              </span>
              <AmountCell cents={r.thisMonth} href={groupHref(month)} />
              <AmountCell
                cents={r.lastMonth}
                href={groupHref(lastMonth)}
                muted
              />
              {hasAvg ? (
                <AmountText
                  cents={r.avg}
                  sign="never"
                  colorize={false}
                  className="text-right text-ink-2"
                />
              ) : (
                <span className="text-right text-ink-3">—</span>
              )}
              <span className="tnum text-right text-caption text-ink-2">
                {Math.round(r.share * 100)}%
              </span>
            </div>
            {isOpen && (
              <div id={`${rowId}-leaves`}>
                {r.leaves?.map((l) => {
                  const leafHref = (m: string) =>
                    l.id === null ? null : leafTransactionsHref(l.id, m);
                  return (
                    <div
                      key={l.name}
                      className={cn(
                        "grid items-center gap-3 border-b border-line bg-subtle/50 py-2 pr-5 pl-12 text-caption",
                        GRID,
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {l.name}
                        <span className="rounded-pill bg-subtle px-1.5 text-micro text-ink-3">
                          {l.isFixed ? "fixed" : "variable"}
                        </span>
                      </span>
                      <AmountCell cents={l.thisMonth} href={leafHref(month)} />
                      <AmountCell
                        cents={l.lastMonth}
                        href={leafHref(lastMonth)}
                        muted
                      />
                      {hasAvg ? (
                        <AmountText
                          cents={l.avg}
                          sign="never"
                          colorize={false}
                          className="text-right text-ink-2"
                        />
                      ) : (
                        <span className="text-right text-ink-3">—</span>
                      )}
                      <span className="tnum text-right text-ink-3">
                        {Math.round(l.share * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className="px-5 py-2 text-micro text-ink-3">Month {month}</div>
    </div>
  );
}
