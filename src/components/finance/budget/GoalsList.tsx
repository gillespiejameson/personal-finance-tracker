"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  archiveGoalAction,
  createGoalAction,
  updateGoalAction,
} from "@/actions/goals";
import { AmountText } from "@/components/finance/AmountText";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PARENT_COLORS } from "@/lib/categories/palette";
import type { Goal } from "@/lib/goals/types";
import { formatCents, parseAmountToCents } from "@/lib/money";

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

function progressLine(goal: Goal): string {
  if (goal.reached) return "Reached";
  if (goal.targetDate === null || goal.monthlyNeededCents === null)
    return "No target date";
  return `${formatCents(goal.monthlyNeededCents, { sign: "never" })}/mo to reach it by ${longDate(goal.targetDate)}`;
}

type FormState = {
  name: string;
  target: string;
  targetDate: string;
  starting: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  target: "",
  targetDate: "",
  starting: "",
};

function GoalForm({
  idPrefix,
  form,
  onChange,
}: {
  idPrefix: string;
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor={`${idPrefix}-name`}
      >
        Name
        <Input
          id={`${idPrefix}-name`}
          value={form.name}
          maxLength={40}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor={`${idPrefix}-target`}
      >
        Target
        <Input
          id={`${idPrefix}-target`}
          inputMode="decimal"
          placeholder="$0.00"
          value={form.target}
          onChange={(e) => onChange({ target: e.target.value })}
        />
      </label>
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor={`${idPrefix}-date`}
      >
        Target date (optional)
        <Input
          id={`${idPrefix}-date`}
          type="date"
          value={form.targetDate}
          onChange={(e) => onChange({ targetDate: e.target.value })}
        />
      </label>
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor={`${idPrefix}-starting`}
      >
        Already saved
        <Input
          id={`${idPrefix}-starting`}
          inputMode="decimal"
          placeholder="$0.00"
          value={form.starting}
          onChange={(e) => onChange({ starting: e.target.value })}
        />
      </label>
    </div>
  );
}

function NewGoalCard() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pending, start] = useTransition();

  function create() {
    const name = form.name.trim();
    if (!name) {
      toast.error("Name a goal first");
      return;
    }
    const targetCents = parseAmountToCents(form.target);
    if (targetCents === null || targetCents <= 0) {
      toast.error("Enter a valid target");
      return;
    }
    const startingCents = form.starting.trim()
      ? parseAmountToCents(form.starting)
      : 0;
    if (startingCents === null || startingCents < 0) {
      toast.error("Enter a valid saved amount");
      return;
    }
    start(async () => {
      const r = await createGoalAction({
        name,
        targetCents,
        targetDate: form.targetDate || null,
        startingCents,
      });
      if (!r.ok) {
        toast.error(r.error ?? "Something went wrong");
        return;
      }
      toast.success("Goal created");
      setForm(EMPTY_FORM);
      router.refresh();
    });
  }

  return (
    <Card>
      <h2 className="mb-3 text-headline font-semibold">New goal</h2>
      <GoalForm
        idPrefix="new-goal"
        form={form}
        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
      />
      <Button className="mt-4" disabled={pending} onClick={create}>
        Create
      </Button>
    </Card>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: goal.name,
    target: (goal.targetCents / 100).toFixed(2),
    targetDate: goal.targetDate ?? "",
    starting: (goal.startingCents / 100).toFixed(2),
  });
  const [pending, start] = useTransition();

  function save() {
    const name = form.name.trim();
    if (!name) {
      toast.error("Name a goal first");
      return;
    }
    const targetCents = parseAmountToCents(form.target);
    if (targetCents === null || targetCents <= 0) {
      toast.error("Enter a valid target");
      return;
    }
    const startingCents = form.starting.trim()
      ? parseAmountToCents(form.starting)
      : 0;
    if (startingCents === null || startingCents < 0) {
      toast.error("Enter a valid saved amount");
      return;
    }
    start(async () => {
      const r = await updateGoalAction({
        id: goal.id,
        name,
        targetCents,
        targetDate: form.targetDate || null,
        startingCents,
      });
      if (!r.ok) {
        toast.error(r.error ?? "Something went wrong");
        return;
      }
      toast.success("Goal saved");
      setEditing(false);
      router.refresh();
    });
  }

  function archive() {
    if (!window.confirm(`Archive "${goal.name}"? This can't be undone.`))
      return;
    start(async () => {
      const r = await archiveGoalAction(goal.id);
      if (!r.ok) {
        toast.error(r.error ?? "Something went wrong");
        return;
      }
      toast.success("Goal archived");
      router.refresh();
    });
  }

  if (editing) {
    return (
      <Card>
        <GoalForm
          idPrefix={`goal-${goal.id}`}
          form={form}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        />
        <div className="mt-4 flex items-center gap-2">
          <Button disabled={pending} onClick={save}>
            Save
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-headline font-semibold">{goal.name}</h3>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              setForm({
                name: goal.name,
                target: (goal.targetCents / 100).toFixed(2),
                targetDate: goal.targetDate ?? "",
                starting: (goal.startingCents / 100).toFixed(2),
              });
              setEditing(true);
            }}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={archive}
          >
            Archive
          </Button>
        </div>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-pill bg-subtle">
        <div
          className="h-full rounded-pill"
          style={{
            width: `${goal.pct * 100}%`,
            backgroundColor: PARENT_COLORS.savings,
          }}
        />
      </div>
      <div className="tnum mt-2 flex items-center justify-between text-caption text-ink-2">
        <span>
          <AmountText
            cents={goal.progressCents}
            sign="never"
            colorize={false}
            className="text-ink"
          />
          {" of "}
          {formatCents(goal.targetCents, { sign: "never" })} ·{" "}
          {Math.round(goal.pct * 100)}%
        </span>
      </div>
      <p className="mt-1 text-caption text-ink-2">{progressLine(goal)}</p>
    </Card>
  );
}

export function GoalsList({ goals }: { goals: Goal[] }) {
  return (
    <div className="grid gap-4">
      <NewGoalCard />
      {goals.map((g) => (
        <GoalCard key={g.id} goal={g} />
      ))}
    </div>
  );
}
