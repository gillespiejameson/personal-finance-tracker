"use client";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeftRight, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { clearSplitsAction } from "@/actions/review";
import {
  applyCategoryToMerchantAction,
  countMerchantMatchesAction,
  restoreCategoriesAction,
  setTransactionCategory,
  type TxnRow,
} from "@/actions/transactions";
import { AmountText } from "@/components/finance/AmountText";
import { CategoryChip } from "@/components/finance/CategoryChip";
import { MarkAsBillForm } from "@/components/finance/MarkAsBillForm";
import { Button } from "@/components/ui/button";

type Cat = {
  id: number;
  name: string;
  color: string;
  parentName: string | null;
};
const ROW = 56;
const SPLIT_LINE = 28;
const SPLIT_PAD = 16;
/** First-paint guess for the apply-to-all prompt and the bill form. */
const EXTRA_ROW = 52;
const UNDO_MS = 10_000;
const GRID = "grid-cols-[110px_1fr_200px_150px_130px_100px]";

/** The apply-to-all question asked right after an inline category change. */
type ApplyPrompt = {
  id: number;
  merchant: string;
  categoryId: number;
  categoryName: string;
  count: number;
  /** Every other row is already in the category: only the rule is new. */
  allSame: boolean;
};

/** The colour the whole split agrees on, or null when the lines disagree. */
function sharedColor(splits: TxnRow["splits"]): string | null {
  if (splits.length === 0) return null;
  const first = splits[0].color;
  return splits.every((s) => s.color === first) ? first : null;
}

function expandedHeight(r: TxnRow): number {
  // One line per split, plus the line holding the Unsplit button.
  return ROW + SPLIT_PAD + SPLIT_LINE * (r.splitCount + 1);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

export function TransactionsTable({
  rows,
  categories,
}: {
  rows: TxnRow[];
  categories: Cat[];
}) {
  const parent = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [prompt, setPrompt] = useState<ApplyPrompt | null>(null);
  const [billFor, setBillFor] = useState<number | null>(null);
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: (i) => {
      const r = rows[i];
      const base = open.has(r.id) ? expandedHeight(r) : ROW;
      const extra = prompt?.id === r.id || billFor === r.id ? EXTRA_ROW : 0;
      return base + extra;
    },
    overscan: 12,
  });
  const [isPending, start] = useTransition();

  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPrompt(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prompt]);

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const changeCategory = (r: TxnRow, categoryId: number | null) =>
    start(async () => {
      try {
        const res = await setTransactionCategory(r.id, categoryId);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        // An earlier prompt is moot once another row (or this one) moves on.
        setPrompt(null);
        if (categoryId === null) return;
        const cat = categories.find((c) => c.id === categoryId);
        const { total, sameCategory } = await countMerchantMatchesAction(r.id);
        if (total > 0 && cat)
          setPrompt({
            id: r.id,
            merchant: r.merchant,
            categoryId,
            categoryName: cat.name,
            count: total,
            allSame: sameCategory === total,
          });
      } catch (e) {
        toast.error(errorMessage(e));
      } finally {
        setEditing(null);
      }
    });

  const applyToAll = (p: ApplyPrompt) =>
    start(async () => {
      try {
        const res = await applyCategoryToMerchantAction({
          id: p.id,
          categoryId: p.categoryId,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setPrompt(null);
        // The toast's button stays clickable while the undo runs; a second
        // click must not restore twice.
        let undoing = false;
        toast.success(`Applied to ${res.applied} transactions`, {
          duration: UNDO_MS,
          action: {
            label: "Undo",
            onClick: async () => {
              if (undoing) return;
              undoing = true;
              try {
                const u = await restoreCategoriesAction(res.previous);
                if (!u.ok) {
                  toast.error(u.error);
                  return;
                }
                toast(`Restored ${res.previous.length} transactions`);
                router.refresh();
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                undoing = false;
              }
            },
          },
        });
        router.refresh();
      } catch (e) {
        toast.error(errorMessage(e));
      }
    });

  const unsplit = (id: number) =>
    start(async () => {
      try {
        const res = await clearSplitsAction(id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setOpen((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        toast.success("Split removed. The transaction is back in Review.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      }
    });

  return (
    <div className="overflow-hidden rounded-card bg-card shadow-card">
      <div
        className={`grid ${GRID} gap-4 border-b border-line px-5 py-3 text-caption font-medium text-ink-2`}
      >
        <span>Date</span>
        <span>Merchant</span>
        <span>Category</span>
        <span>Account</span>
        <span className="text-right">Amount</span>
        <span className="sr-only">Actions</span>
      </div>
      <div ref={parent} className="max-h-[calc(100vh-260px)] overflow-y-auto">
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((vi) => {
            const r = rows[vi.index];
            const isOpen = open.has(r.id);
            const splitColor = sharedColor(r.splits);
            const showPrompt = prompt?.id === r.id ? prompt : null;
            const showBill = billFor === r.id;
            return (
              <div
                key={r.id}
                // Expanding a row changes its height, so the virtualizer
                // measures the rendered element rather than trusting
                // `estimateSize` (which is only the first-paint guess).
                ref={v.measureElement}
                data-index={vi.index}
                className="absolute left-0 w-full border-b border-line"
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <div
                  className={`grid ${GRID} items-center gap-4 px-5 transition-colors hover:bg-subtle`}
                  style={{ height: ROW }}
                >
                  <span className="tnum text-caption text-ink-2">{r.date}</span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2 text-body font-medium">
                      <span className="truncate">{r.merchant}</span>
                      {r.isTransfer && (
                        <ArrowLeftRight className="size-3.5 text-ink-3" />
                      )}
                      {r.possibleDuplicate && (
                        <span title="Possible duplicate">
                          <Copy className="size-3.5 text-warning" />
                        </span>
                      )}
                      {r.pending && (
                        <span
                          className="shrink-0 rounded-pill bg-subtle px-1.5 text-micro font-semibold text-ink-2"
                          title="Still pending at the bank; the amount or date can change"
                        >
                          pending
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-micro text-ink-3">
                      {r.rawDescription}
                    </span>
                  </span>
                  <span>
                    {r.splitCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggle(r.id)}
                        aria-expanded={isOpen}
                        className="flex items-center gap-1 rounded-pill transition-transform hover:scale-105"
                      >
                        {isOpen ? (
                          <ChevronDown className="size-3.5 text-ink-3" />
                        ) : (
                          <ChevronRight className="size-3.5 text-ink-3" />
                        )}
                        {splitColor ? (
                          <CategoryChip
                            name={`Split · ${r.splitCount}`}
                            color={splitColor}
                          />
                        ) : (
                          <span className="inline-flex items-center rounded-pill bg-subtle px-2.5 py-1 text-caption font-medium text-ink-2">
                            {`Split · ${r.splitCount}`}
                          </span>
                        )}
                      </button>
                    ) : editing === r.id ? (
                      <select
                        ref={(el) => el?.focus()}
                        className="h-8 w-full rounded-control border border-line bg-card px-2 text-caption"
                        defaultValue={r.categoryId ?? ""}
                        onBlur={() => setEditing(null)}
                        onChange={(e) =>
                          changeCategory(
                            r,
                            e.target.value ? Number(e.target.value) : null,
                          )
                        }
                      >
                        <option value="">Uncategorized</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.parentName ? `${c.parentName} › ` : ""}
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditing(r.id)}
                        className="rounded-pill transition-transform hover:scale-105"
                      >
                        <CategoryChip
                          name={r.categoryName}
                          color={r.categoryColor}
                          dashed={r.categoryId === null}
                        />
                      </button>
                    )}
                  </span>
                  <span className="flex items-center gap-2 text-caption text-ink-2">
                    <span
                      className="size-2.5 rounded-pill"
                      style={{ backgroundColor: r.accountColor }}
                    />
                    {r.accountName}
                  </span>
                  <AmountText
                    cents={r.amountCents}
                    size="body"
                    className="text-right font-medium"
                  />
                  <span className="flex justify-end">
                    {!r.isTransfer && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-ink-2"
                        aria-expanded={showBill}
                        onClick={() => setBillFor(showBill ? null : r.id)}
                      >
                        Mark as bill…
                      </Button>
                    )}
                  </span>
                </div>
                {showPrompt && (
                  <div className="flex flex-wrap items-center gap-3 bg-subtle px-5 py-2 text-caption">
                    {showPrompt.allSame ? (
                      <span className="text-ink-2">
                        Make{" "}
                        <span className="font-medium text-ink">
                          {showPrompt.categoryName}
                        </span>{" "}
                        the rule for{" "}
                        <span className="font-medium text-ink">
                          {showPrompt.merchant}
                        </span>{" "}
                        going forward?
                      </span>
                    ) : (
                      <span className="text-ink-2">
                        Apply{" "}
                        <span className="font-medium text-ink">
                          {showPrompt.categoryName}
                        </span>{" "}
                        to the other{" "}
                        <span className="tnum font-medium text-ink">
                          {showPrompt.count}
                        </span>{" "}
                        <span className="font-medium text-ink">
                          {showPrompt.merchant}
                        </span>{" "}
                        transaction{showPrompt.count === 1 ? "" : "s"} and
                        future ones?
                      </span>
                    )}
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() => applyToAll(showPrompt)}
                    >
                      Apply to all
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => setPrompt(null)}
                    >
                      Just this one
                    </Button>
                  </div>
                )}
                {showBill && (
                  <div className="bg-subtle px-5 py-2">
                    <MarkAsBillForm
                      transactionId={r.id}
                      merchant={r.merchant}
                      amountCents={r.amountCents}
                      date={r.date}
                      onSaved={() => {
                        setBillFor(null);
                        router.refresh();
                      }}
                      onCancel={() => setBillFor(null)}
                    />
                  </div>
                )}
                {isOpen && (
                  <div className="bg-subtle px-5 py-2">
                    {r.splits.map((s, i) => (
                      <div
                        key={`${r.id}-${i}-${s.categoryName}`}
                        className={`grid ${GRID} items-center gap-4`}
                        style={{ height: SPLIT_LINE }}
                      >
                        <span />
                        <span className="pl-6 text-caption text-ink-3">
                          Split line {i + 1}
                        </span>
                        <span>
                          <CategoryChip name={s.categoryName} color={s.color} />
                        </span>
                        <span />
                        <AmountText
                          cents={s.amountCents}
                          size="caption"
                          className="text-right"
                        />
                        <span />
                      </div>
                    ))}
                    <div
                      className="flex items-center"
                      style={{ height: SPLIT_LINE }}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => unsplit(r.id)}
                      >
                        Unsplit
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {rows.length === 0 && (
        <div className="p-10 text-center text-ink-2">
          No transactions match.
        </div>
      )}
    </div>
  );
}
