"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type CategoryOption,
  createAliasAction,
  decideCategory,
  previewAlways,
  type ReviewItem,
  resolveDuplicate,
  resolveRefund,
  restoreTransaction,
  type Suggestion,
  saveSplitsAction,
  toggleTransfer,
} from "@/actions/review";
import { CategoryPicker } from "@/components/finance/CategoryPicker";
import { MarkAsBillForm } from "@/components/finance/MarkAsBillForm";
import { ReviewCard } from "@/components/finance/ReviewCard";
import { SplitDialog } from "@/components/finance/SplitDialog";
import { Button } from "@/components/ui/button";

type Props = {
  items: ReviewItem[];
  suggestions: Record<number, Suggestion[]>;
  count: number;
  categories: CategoryOption[];
};
type Overlay = "none" | "picker" | "split" | "bill";
type PrevState = {
  categoryId: number | null;
  reviewed: boolean;
  isTransfer: boolean;
  possibleDuplicate: boolean;
};
/**
 * A "local" entry only moved the item within the local queue (Later), so
 * undoing it costs nothing. A "server" entry wrote to the database, and
 * undoing it puts `prev` back through `restoreTransaction`.
 */
type UndoEntry =
  | { kind: "local"; item: ReviewItem }
  | { kind: "server"; item: ReviewItem; prev: PrevState };

const SPRING = { type: "spring", stiffness: 400, damping: 30 } as const;
const UNDO_LIMIT = 20;
/** How long the second M press has to arrive. */
const DELETE_CONFIRM_MS = 3000;

/** Queue items are unreviewed by definition, so the "before" state is exact. */
function prevOf(item: ReviewItem): PrevState {
  return {
    categoryId: item.categoryId,
    reviewed: false,
    isTransfer: item.isTransfer,
    possibleDuplicate: item.possibleDuplicate,
  };
}

export function ReviewScreen({
  items: initial,
  suggestions,
  count: initialCount,
  categories,
}: Props) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [items, setItems] = useState(initial);
  const [count, setCount] = useState(initialCount);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [always, setAlways] = useState(false);
  const [alwaysCount, setAlwaysCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const current = items[0];

  // Nothing renders from the stack, so a ref keeps undo off the render path.
  const undoStack = useRef<UndoEntry[]>([]);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tracks the id of the batch (`initial[0]?.id`) that's currently adopted
  // into local `items` state. Initialized to the mount-time batch, which is
  // already "adopted" via useState(initial) above.
  const adoptedFirstId = useRef<number | null>(initial[0]?.id ?? null);
  // The id of the item `advance()` most recently removed. Next.js refreshes
  // this route's props automatically after every server action that calls
  // revalidatePath (not just when *we* call router.refresh()), and that
  // implicit refresh can occasionally race the mutation and hand back a
  // batch whose first item is the one we *just* finished — this guards
  // against re-adopting that same item a second time.
  const lastProcessedId = useRef<number | null>(null);
  // Guards router.refresh() so it's only called once per distinct
  // not-yet-adoptable `initial[0]?.id` we've seen while waiting.
  const refreshedFor = useRef<number | null>(null);

  const advance = useCallback(() => {
    setItems((xs) => {
      lastProcessedId.current = xs[0]?.id ?? null;
      return xs.slice(1);
    });
    setCount((c) => Math.max(0, c - 1));
    setOverlay("none");
    setAlways(false);
    setAlwaysCount(null);
  }, []);

  const pushUndo = useCallback((entry: UndoEntry) => {
    undoStack.current = [...undoStack.current, entry].slice(-UNDO_LIMIT);
  }, []);

  /**
   * "Later", not "never": the item goes to the back of the local queue and
   * nothing is written, so it comes back on the next reload.
   */
  const later = useCallback(() => {
    if (items.length < 2) {
      toast("Only one left — pick a category or press T/S.");
      return;
    }
    pushUndo({ kind: "local", item: items[0] });
    setItems([...items.slice(1), items[0]]);
    setOverlay("none");
    setAlways(false);
    setAlwaysCount(null);
  }, [items, pushUndo]);

  /**
   * Marking a bill does not decide the row's category, so the item still
   * needs a look: it goes to the back of the queue rather than out of it.
   */
  const afterBill = useCallback(() => {
    setOverlay("none");
    if (items.length < 2) return;
    setItems([...items.slice(1), items[0]]);
    setAlways(false);
    setAlwaysCount(null);
  }, [items]);

  const run = useCallback(
    async (
      fn: () => Promise<{ ok: boolean; error?: string } | undefined>,
      done = true,
      undoable?: ReviewItem,
    ) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fn();
        if (res && !res.ok) {
          toast.error(res.error ?? "Something went wrong");
          return;
        }
        if (undoable)
          pushUndo({ kind: "server", item: undoable, prev: prevOf(undoable) });
        if (done) advance();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    },
    [busy, advance, pushUndo],
  );

  /**
   * Put the last decision back. A rule created by "always" is not withdrawn:
   * undo restores this row, not the rest of the batch that rule categorized.
   */
  const undo = useCallback(() => {
    const entry = undoStack.current.at(-1);
    if (!entry) {
      toast("Nothing to undo.");
      return;
    }
    if (entry.kind === "local") {
      undoStack.current = undoStack.current.slice(0, -1);
      setItems((xs) => [
        entry.item,
        ...xs.filter((x) => x.id !== entry.item.id),
      ]);
      return;
    }
    run(async () => {
      const res = await restoreTransaction({
        id: entry.item.id,
        ...entry.prev,
      });
      if (!res.ok) return res;
      undoStack.current = undoStack.current.slice(0, -1);
      setItems((xs) =>
        xs.some((x) => x.id === entry.item.id) ? xs : [entry.item, ...xs],
      );
      setCount((c) => c + 1);
      return res;
    }, false);
  }, [run]);

  const pick = useCallback(
    (c: { categoryId: number; name: string }) => {
      if (!current) return;
      run(
        async () => {
          const res = await decideCategory({
            id: current.id,
            categoryId: c.categoryId,
            always: always
              ? { pattern: current.merchant, field: "merchant" }
              : undefined,
          });
          if (res.ok && res.ruleApplied !== undefined)
            toast.success(
              `Rule saved. ${res.ruleApplied} other transactions categorized as ${c.name}.`,
            );
          return res;
        },
        true,
        current,
      );
    },
    [current, always, run],
  );

  useEffect(() => {
    if (!always || !current) {
      setAlwaysCount(null);
      return;
    }
    previewAlways({
      pattern: current.merchant,
      field: "merchant",
      amountCents: current.amountCents,
    })
      .then(setAlwaysCount)
      .catch(() => setAlwaysCount(null));
  }, [always, current]);

  useEffect(
    () => () => {
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (overlay !== "none" || busy) return;
      const el = e.target as HTMLElement | null;
      if (
        el?.closest(
          "button, a, input, textarea, select, [contenteditable=true]",
        )
      )
        return;
      // Undo still works once the queue has emptied.
      if (e.key === "z" || e.key === "Z") {
        undo();
        return;
      }
      if (!current) return;
      const s = suggestions[current.id] ?? [];
      if (/^[1-9]$/.test(e.key)) {
        const pickIdx = Number(e.key) - 1;
        if (s[pickIdx]) pick(s[pickIdx]);
        return;
      }
      switch (e.key) {
        case "/":
          e.preventDefault();
          setOverlay("picker");
          break;
        case "Enter":
          if (s[0]) pick(s[0]);
          break;
        case "ArrowRight":
        case "j":
        case "J":
          later();
          break;
        case "s":
        case "S":
          setOverlay("split");
          break;
        case "t":
        case "T":
          run(() => toggleTransfer(current.id), true, current);
          break;
        case "a":
        case "A":
          setAlways((v) => !v);
          break;
        case "b":
        case "B":
          if (!current.isTransfer) setOverlay("bill");
          break;
        case "d":
        case "D":
          if (current.reason === "duplicate")
            run(
              () => resolveDuplicate({ id: current.id, action: "keep" }),
              true,
              current,
            );
          break;
        case "m":
        case "M": {
          // Deleting a row cannot be undone, so it takes two presses.
          if (current.reason !== "duplicate") break;
          if (deleteTimer.current) clearTimeout(deleteTimer.current);
          if (pendingDelete === current.id) {
            setPendingDelete(null);
            run(() => resolveDuplicate({ id: current.id, action: "delete" }));
          } else {
            setPendingDelete(current.id);
            deleteTimer.current = setTimeout(
              () => setPendingDelete(null),
              DELETE_CONFIRM_MS,
            );
          }
          break;
        }
        case "r":
        case "R":
          if (current.reason === "refund")
            run(
              () => resolveRefund({ id: current.id, confirm: true }),
              true,
              current,
            );
          break;
        case "x":
        case "X":
          // Undo restores the row, but not the refund link this clears.
          if (current.reason === "refund")
            run(
              () => resolveRefund({ id: current.id, confirm: false }),
              true,
              current,
            );
          break;
        case "n":
        case "N": {
          const name = window.prompt(
            "Show this merchant as:",
            current.merchant,
          );
          if (name)
            run(async () => {
              const r = await createAliasAction({
                pattern: current.merchant,
                merchant: name,
              });
              if (r.ok) {
                toast.success(`Renamed on ${r.updated} transactions`);
                setItems((xs) =>
                  xs.map((x) =>
                    x.id === current.id ? { ...x, merchant: name } : x,
                  ),
                );
              }
              return r;
            }, false);
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    current,
    overlay,
    busy,
    suggestions,
    pick,
    run,
    later,
    undo,
    pendingDelete,
  ]);

  // Once the local queue is exhausted, either adopt a genuinely fresh batch
  // or ask the server for one — never mid-batch, so a decision the user is
  // still acting on isn't clobbered by a slightly stale server payload (see
  // round 1's "stale remount" bug and round 2's "remount cuts the animation
  // short" bug).
  useEffect(() => {
    if (items.length !== 0 || initial.length === 0) return;
    const freshId = initial[0]?.id ?? null;
    const isNew =
      freshId !== adoptedFirstId.current && freshId !== lastProcessedId.current;
    if (isNew) {
      adoptedFirstId.current = freshId;
      setItems(initial);
      setCount(initialCount);
      return;
    }
    if (refreshedFor.current !== freshId) {
      refreshedFor.current = freshId;
      router.refresh();
    }
  }, [initial, initialCount, items.length, router]);

  if (!current) {
    if (count > 0) {
      return (
        <div className="rounded-card bg-card p-10 text-center shadow-card">
          <div className="text-title font-semibold">
            Loading the next batch…
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-card bg-card p-10 text-center shadow-card">
        <div className="text-title font-semibold">All caught up.</div>
        <p className="mt-2 text-body text-ink-2">
          Nothing needs a look right now. <kbd>Z</kbd> undoes the last decision.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between text-caption text-ink-2">
        <span className="tnum">{count} to review</span>
        <span className="hidden gap-3 md:flex">
          <kbd>1–9</kbd> pick · <kbd>/</kbd> search · <kbd>Enter</kbd> accept
          first · <kbd>→</kbd> later · <kbd>S</kbd> split · <kbd>T</kbd>{" "}
          transfer · <kbd>A</kbd> always · <kbd>B</kbd> bill · <kbd>N</kbd>{" "}
          rename merchant · <kbd>Z</kbd> undo
        </span>
      </div>
      <div className="relative">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={current.id}
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: 80 }}
            transition={SPRING}
          >
            <ReviewCard
              item={current}
              suggestions={suggestions[current.id] ?? []}
              onSuggestion={pick}
              confirmDelete={pendingDelete === current.id}
            />
          </motion.div>
        </AnimatePresence>
        {items[1] && (
          <div
            className="-z-10 absolute inset-x-4 top-3 h-full rounded-card bg-card opacity-60 shadow-card"
            aria-hidden
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setOverlay("picker")}>
          Choose category…
        </Button>
        <Button variant="ghost" onClick={later}>
          Later
        </Button>
        <Button variant="ghost" onClick={undo}>
          Undo
        </Button>
        <Button variant="ghost" onClick={() => setOverlay("split")}>
          Split
        </Button>
        <Button
          variant="ghost"
          onClick={() => run(() => toggleTransfer(current.id), true, current)}
        >
          Mark as transfer
        </Button>
        {!current.isTransfer && (
          <Button
            variant="ghost"
            aria-expanded={overlay === "bill"}
            onClick={() => setOverlay(overlay === "bill" ? "none" : "bill")}
          >
            Mark as bill
          </Button>
        )}
        <label className="ml-auto flex items-center gap-2 text-caption text-ink-2">
          <input
            type="checkbox"
            checked={always}
            onChange={(e) => setAlways(e.target.checked)}
          />
          Always categorize “{current.merchant}” this way
          {alwaysCount !== null && (
            <span className="tnum text-ink-3">({alwaysCount} match)</span>
          )}
        </label>
      </div>
      {overlay === "bill" && (
        <div className="rounded-card bg-card p-4 shadow-card">
          <MarkAsBillForm
            key={current.id}
            transactionId={current.id}
            merchant={current.merchant}
            amountCents={current.amountCents}
            date={current.date}
            onSaved={afterBill}
            onCancel={() => setOverlay("none")}
          />
        </div>
      )}
      {overlay === "picker" && (
        <CategoryPicker
          categories={categories}
          onPick={(c) => pick({ categoryId: c.id, name: c.name })}
          onClose={() => setOverlay("none")}
        />
      )}
      {overlay === "split" && (
        <SplitDialog
          totalCents={current.amountCents}
          categories={categories}
          onClose={() => setOverlay("none")}
          onSave={async (rows) => {
            await run(() => saveSplitsAction({ id: current.id, rows }));
          }}
        />
      )}
    </div>
  );
}
