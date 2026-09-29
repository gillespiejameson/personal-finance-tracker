"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { CategoryOption } from "@/actions/review";
import {
  archivePlannedExpense,
  createPlannedExpense,
  updatePlannedExpense,
} from "@/actions/spreading";
import { AmountText } from "@/components/finance/AmountText";
import { CategoryChip } from "@/components/finance/CategoryChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PARENT_COLORS } from "@/lib/categories/palette";
import { formatCents, parseAmountToCents } from "@/lib/money";
import type { Every, IrregularItem } from "@/lib/spreading/types";

const EVERY_LABEL: Record<Every, string> = {
  year: "Yearly",
  quarter: "Quarterly",
  once: "One-time",
};

const ROW_GRID = "grid-cols-[1fr_110px_110px_180px_150px]";

type RunFn = <R extends { ok: boolean; error?: string }>(
  fn: () => Promise<R>,
  done?: (r: Extract<R, { ok: true }>) => string,
) => void;

type FormState = {
  name: string;
  amount: string;
  every: Every;
  dueDate: string;
  categoryId: string; // "" = none
};

const EMPTY_FORM: FormState = {
  name: "",
  amount: "",
  every: "year",
  dueDate: "",
  categoryId: "",
};

function formFromItem(item: IrregularItem): FormState {
  const p = item.planned;
  return {
    name: p?.name ?? item.name,
    amount: ((p?.amountCents ?? item.amountCents) / 100).toFixed(2),
    every: p?.every ?? "year",
    dueDate: p?.dueDate ?? "",
    categoryId: item.categoryId !== null ? String(item.categoryId) : "",
  };
}

function validate(form: FormState): {
  name: string;
  amountCents: number;
  dueDate: string;
  every: Every;
  categoryId: number | null;
} | null {
  const name = form.name.trim();
  if (!name) {
    toast.error("Name it first");
    return null;
  }
  const amountCents = parseAmountToCents(form.amount);
  if (amountCents === null || amountCents <= 0) {
    toast.error("Enter a valid amount");
    return null;
  }
  if (!form.dueDate) {
    toast.error("Pick a due date");
    return null;
  }
  return {
    name,
    amountCents,
    dueDate: form.dueDate,
    every: form.every,
    categoryId: form.categoryId ? Number(form.categoryId) : null,
  };
}

function PlannedFields({
  idPrefix,
  form,
  categories,
  onChange,
}: {
  idPrefix: string;
  form: FormState;
  categories: CategoryOption[];
  onChange: (patch: Partial<FormState>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor={`${idPrefix}-name`}
      >
        Name
        <Input
          id={`${idPrefix}-name`}
          value={form.name}
          maxLength={60}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor={`${idPrefix}-amount`}
      >
        Amount
        <Input
          id={`${idPrefix}-amount`}
          inputMode="decimal"
          placeholder="$0.00"
          value={form.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
        />
      </label>
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor={`${idPrefix}-every`}
      >
        Every
        <select
          id={`${idPrefix}-every`}
          className="h-8 rounded-control border border-line bg-card px-2 text-body"
          value={form.every}
          onChange={(e) => onChange({ every: e.target.value as Every })}
        >
          <option value="year">Yearly</option>
          <option value="quarter">Quarterly</option>
          <option value="once">One-time</option>
        </select>
      </label>
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor={`${idPrefix}-due`}
      >
        Due date
        <Input
          id={`${idPrefix}-due`}
          type="date"
          value={form.dueDate}
          onChange={(e) => onChange({ dueDate: e.target.value })}
        />
      </label>
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor={`${idPrefix}-category`}
      >
        Category
        <select
          id={`${idPrefix}-category`}
          className="h-8 rounded-control border border-line bg-card px-2 text-body"
          value={form.categoryId}
          onChange={(e) => onChange({ categoryId: e.target.value })}
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parentName ? `${c.parentName} › ` : ""}
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ProgressBar({
  accruedCents,
  amountCents,
  color,
}: {
  accruedCents: number;
  amountCents: number;
  color: string;
}) {
  const pct =
    amountCents > 0 ? Math.min(1, Math.max(0, accruedCents / amountCents)) : 0;
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-pill bg-subtle">
        <div
          className="h-full rounded-pill"
          style={{ width: `${pct * 100}%`, backgroundColor: color }}
        />
      </div>
      <div className="tnum mt-1 text-micro text-ink-3">
        {formatCents(accruedCents, { sign: "never" })} of{" "}
        {formatCents(amountCents, { sign: "never" })} set aside
      </div>
    </div>
  );
}

function DetectedRow({ item }: { item: IrregularItem }) {
  return (
    <div
      className={`grid items-center gap-4 border-b border-line px-5 py-3 ${ROW_GRID}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 truncate text-body font-medium">
          {item.name}
          <span className="rounded-pill bg-subtle px-2 py-0.5 text-micro text-ink-2">
            Detected
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-caption text-ink-2">
          <CategoryChip
            name={item.categoryName ?? "Uncategorized"}
            color={item.color ?? PARENT_COLORS.uncategorized}
            dashed={!item.categoryName}
          />
          <span className="rounded-pill bg-subtle px-2 py-0.5 text-micro">
            {EVERY_LABEL[item.every]}
          </span>
        </div>
      </div>
      <div className="flex items-baseline justify-end gap-1">
        <AmountText cents={item.monthlyCents} sign="never" colorize={false} />
        <span className="text-caption text-ink-2">/mo</span>
      </div>
      <div className="tnum text-caption text-ink-2">
        {item.nextDue ? `due ${item.nextDue}` : "passed"}
      </div>
      <ProgressBar
        accruedCents={item.accruedCents}
        amountCents={item.amountCents}
        color={item.color ?? PARENT_COLORS.savings}
      />
      <div />
    </div>
  );
}

function PlannedRow({
  item,
  categories,
  pending,
  run,
}: {
  item: IrregularItem;
  categories: CategoryOption[];
  pending: boolean;
  run: RunFn;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(() => formFromItem(item));

  function save() {
    const patch = validate(form);
    if (!patch) return;
    run(
      () => updatePlannedExpense({ id: item.id, ...patch }),
      () => {
        setEditing(false);
        return "Planned expense saved";
      },
    );
  }

  function archive() {
    if (
      !window.confirm(
        "Archive this planned expense? It disappears from Bills and Budget.",
      )
    )
      return;
    run(
      () => archivePlannedExpense(item.id),
      () => "Archived",
    );
  }

  if (editing) {
    return (
      <div className="border-b border-line px-5 py-3">
        <PlannedFields
          idPrefix={`planned-${item.id}`}
          form={form}
          categories={categories}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        />
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={pending} onClick={save}>
            Save
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`grid items-center gap-4 border-b border-line px-5 py-3 ${ROW_GRID}`}
    >
      <div className="min-w-0">
        <div className="truncate text-body font-medium">{item.name}</div>
        <div className="mt-1 flex items-center gap-2 text-caption text-ink-2">
          <CategoryChip
            name={item.categoryName ?? "Uncategorized"}
            color={item.color ?? PARENT_COLORS.uncategorized}
            dashed={!item.categoryName}
          />
          <span className="rounded-pill bg-subtle px-2 py-0.5 text-micro">
            {EVERY_LABEL[item.every]}
          </span>
        </div>
      </div>
      <div className="flex items-baseline justify-end gap-1">
        <AmountText cents={item.monthlyCents} sign="never" colorize={false} />
        <span className="text-caption text-ink-2">/mo</span>
      </div>
      <div className="tnum text-caption text-ink-2">
        {item.nextDue ? `due ${item.nextDue}` : "passed"}
      </div>
      <ProgressBar
        accruedCents={item.accruedCents}
        amountCents={item.amountCents}
        color={item.color ?? PARENT_COLORS.savings}
      />
      <div className="flex justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            setForm(formFromItem(item));
            setEditing(true);
          }}
        >
          Edit
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={archive}>
          Archive
        </Button>
      </div>
    </div>
  );
}

export function IrregularExpenses({
  items,
  categories,
}: {
  items: IrregularItem[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const run: RunFn = (fn, done) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error ?? "Something went wrong");
        return;
      }
      if (done) toast.success(done(r as Extract<typeof r, { ok: true }>));
      router.refresh();
    });

  function add() {
    const patch = validate(form);
    if (!patch) return;
    run(
      () => createPlannedExpense(patch),
      () => {
        setForm(EMPTY_FORM);
        setAdding(false);
        return "Planned expense added";
      },
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-headline font-semibold">Irregular expenses</h2>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            Add planned expense
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-card bg-card shadow-card">
        {adding && (
          <div className="border-b border-line px-5 py-3">
            <PlannedFields
              idPrefix="new-planned"
              form={form}
              categories={categories}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            />
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={pending} onClick={add}>
                Add
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setAdding(false);
                  setForm(EMPTY_FORM);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {items.map((item) =>
          item.source === "bill" ? (
            <DetectedRow key={item.key} item={item} />
          ) : (
            <PlannedRow
              key={item.key}
              item={item}
              categories={categories}
              pending={pending}
              run={run}
            />
          ),
        )}
        {items.length === 0 && !adding && (
          <div className="p-8 text-center text-ink-2">
            No irregular expenses yet. Add one you know is coming.
          </div>
        )}
      </div>
    </div>
  );
}
