"use client";
import { useEffect, useMemo, useState } from "react";
import type { CategoryOption } from "@/actions/review";
import { CategoryChip } from "@/components/finance/CategoryChip";
import { Input } from "@/components/ui/input";

type Props = {
  categories: CategoryOption[];
  onPick: (c: CategoryOption) => void;
  onClose: () => void;
};

const INPUT_ID = "category-picker-search";

export function CategoryPicker({ categories, onPick, onClose }: Props) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    document.getElementById(INPUT_ID)?.focus();
  }, []);
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? categories.filter((c) =>
          `${c.parentName ?? ""} ${c.name}`.toLowerCase().includes(needle),
        )
      : categories;
    return list.slice(0, 12);
  }, [q, categories]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset cursor whenever the query text changes
  useEffect(() => setCursor(0), [q]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard nav container for the search listbox, not itself interactive
    <div
      className="rounded-card bg-card p-3 shadow-float"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setCursor((c) => Math.min(c + 1, matches.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setCursor((c) => Math.max(c - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault();
          const m = matches[cursor];
          if (m) onPick(m);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
        e.stopPropagation();
      }}
    >
      <Input
        id={INPUT_ID}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search categories…"
        className="mb-2 rounded-control"
      />
      <ul className="max-h-72 overflow-y-auto">
        {matches.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              onMouseEnter={() => setCursor(i)}
              onClick={() => onPick(c)}
              className={`flex w-full items-center justify-between rounded-control px-2 py-1.5 text-left text-body ${i === cursor ? "bg-subtle" : ""}`}
            >
              <CategoryChip name={c.name} color={c.color} />
              <span className="text-caption text-ink-3">{c.parentName}</span>
            </button>
          </li>
        ))}
        {matches.length === 0 && (
          <li className="px-2 py-2 text-caption text-ink-3">No match</li>
        )}
      </ul>
    </div>
  );
}
