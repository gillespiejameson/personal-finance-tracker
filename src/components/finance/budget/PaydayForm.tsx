"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { clearPaydayAction, setPaydayAction } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PaydayConfig, ResolvedPayday } from "@/lib/budget/types";

type Schedule = PaydayConfig["schedule"];

const SCHEDULES: { value: Schedule; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "semimonthly", label: "Twice a month" },
  { value: "monthly", label: "Monthly" },
];

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

function toForm(cfg: PaydayConfig | undefined) {
  return {
    schedule: (cfg?.schedule ?? "weekly") as Schedule,
    anchor: cfg && "anchor" in cfg ? cfg.anchor : "",
    day1: cfg && "days" in cfg ? String(cfg.days[0]) : "1",
    day2: cfg && "days" in cfg ? String(cfg.days[1]) : "15",
    day: cfg && "day" in cfg ? String(cfg.day) : "1",
  };
}

export function PaydayForm({
  stored,
  resolved,
}: {
  stored: PaydayConfig | null;
  resolved: ResolvedPayday;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => toForm(stored ?? resolved?.config));
  const [pending, start] = useTransition();

  function buildConfig(): PaydayConfig | null {
    if (form.schedule === "weekly" || form.schedule === "biweekly") {
      if (!form.anchor) return null;
      return { schedule: form.schedule, anchor: form.anchor };
    }
    if (form.schedule === "semimonthly") {
      const a = Number(form.day1);
      const b = Number(form.day2);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return null;
      return { schedule: "semimonthly", days: [a, b] };
    }
    const d = Number(form.day);
    if (!Number.isInteger(d)) return null;
    return { schedule: "monthly", day: d };
  }

  function save() {
    const cfg = buildConfig();
    if (!cfg) {
      toast.error("Fill in the schedule fields");
      return;
    }
    start(async () => {
      const r = await setPaydayAction(cfg);
      if (!r.ok) {
        toast.error(r.error ?? "Something went wrong");
        return;
      }
      toast.success("Payday saved");
      router.refresh();
    });
  }

  function useInferred() {
    start(async () => {
      const r = await clearPaydayAction();
      if (!r.ok) return;
      toast.success("Using inferred payday");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      {!stored && resolved?.inferred && (
        <p className="text-caption text-ink-2">
          Inferred from your paycheck — save to confirm
        </p>
      )}
      <label className="grid gap-1 text-caption text-ink-2">
        Schedule
        <select
          value={form.schedule}
          onChange={(e) =>
            setForm((f) => ({ ...f, schedule: e.target.value as Schedule }))
          }
          className="h-8 w-full max-w-56 rounded-control border border-line bg-transparent px-2.5 text-body"
        >
          {SCHEDULES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {(form.schedule === "weekly" || form.schedule === "biweekly") && (
        <label
          className="grid max-w-56 gap-1 text-caption text-ink-2"
          htmlFor="payday-anchor"
        >
          Anchor date
          <Input
            id="payday-anchor"
            type="date"
            value={form.anchor}
            onChange={(e) => setForm((f) => ({ ...f, anchor: e.target.value }))}
          />
        </label>
      )}

      {form.schedule === "semimonthly" && (
        <div className="flex max-w-56 gap-3">
          <label
            className="grid flex-1 gap-1 text-caption text-ink-2"
            htmlFor="payday-day1"
          >
            Day 1
            <Input
              id="payday-day1"
              type="number"
              min={1}
              max={31}
              value={form.day1}
              onChange={(e) => setForm((f) => ({ ...f, day1: e.target.value }))}
            />
          </label>
          <label
            className="grid flex-1 gap-1 text-caption text-ink-2"
            htmlFor="payday-day2"
          >
            Day 2
            <Input
              id="payday-day2"
              type="number"
              min={1}
              max={31}
              value={form.day2}
              onChange={(e) => setForm((f) => ({ ...f, day2: e.target.value }))}
            />
          </label>
        </div>
      )}

      {form.schedule === "monthly" && (
        <label
          className="grid max-w-56 gap-1 text-caption text-ink-2"
          htmlFor="payday-day"
        >
          Day of month
          <Input
            id="payday-day"
            type="number"
            min={1}
            max={31}
            value={form.day}
            onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))}
          />
        </label>
      )}

      {resolved?.next && (
        <p className="text-caption text-ink-2">
          Next payday: {longDate(resolved.next)}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button disabled={pending} onClick={save}>
          Save
        </Button>
        {stored && (
          <Button variant="outline" disabled={pending} onClick={useInferred}>
            Use inferred
          </Button>
        )}
      </div>
    </div>
  );
}
