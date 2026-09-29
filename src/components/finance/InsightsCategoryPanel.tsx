"use client";
import { type ReactNode, useEffect, useState } from "react";
import {
  CategoryTable,
  categoryRowId,
} from "@/components/finance/CategoryTable";
import { CategoryDonut } from "@/components/finance/charts/CategoryDonut";
import { Card } from "@/components/ui/card";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import type { CategoryRow } from "@/lib/insights/aggregate";

/**
 * The donut and the category table share one "open groups" set. Clicking a
 * slice opens (or closes) its group in the table and scrolls it into view;
 * hovering a slice tints the matching row. `children` render between the two
 * so the page grid keeps its order (donut card, cash-flow card, table).
 */
export function InsightsCategoryPanel({
  rows,
  month,
  totalCents,
  children,
}: {
  rows: CategoryRow[];
  month: string;
  totalCents: number;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // A fresh object per click, so re-selecting the same group scrolls again.
  const [scrollReq, setScrollReq] = useState<{
    key: number | "uncategorized";
  } | null>(null);

  const toggle = (name: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });

  const selectFromDonut = (name: string) => {
    const row = rows.find((r) => r.name === name);
    if (!row) return;
    const expandable = (row.leaves?.length ?? 0) > 0;
    // A second click on the open (or, for a leafless group, the selected)
    // slice puts the donut back to showing everything.
    if (open.has(name) || (!expandable && selected === name)) {
      if (open.has(name)) toggle(name);
      setSelected(null);
      return;
    }
    if (expandable) toggle(name);
    setSelected(name);
    // Scrolls after the commit that renders the leaves, so the row centers
    // on its expanded height.
    setScrollReq({ key: row.id ?? "uncategorized" });
  };

  useEffect(() => {
    if (scrollReq === null) return;
    document.getElementById(categoryRowId(scrollReq.key))?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "center",
    });
  }, [scrollReq, reduce]);

  const slices = rows.map((r) => ({
    name: r.name,
    value: r.thisMonth,
    color: r.color,
  }));

  return (
    <>
      <Card className="col-span-5 self-start">
        <h2 className="mb-2 text-headline font-semibold">By category</h2>
        <CategoryDonut
          slices={slices}
          totalCents={totalCents}
          activeName={selected}
          onSelect={selectFromDonut}
          onHover={setHover}
        />
      </Card>
      {children}
      <div className="col-span-12">
        <CategoryTable
          rows={rows}
          month={month}
          open={open}
          onToggle={(name) => {
            toggle(name);
            if (selected === name) setSelected(null);
          }}
          highlight={hover}
        />
      </div>
    </>
  );
}
