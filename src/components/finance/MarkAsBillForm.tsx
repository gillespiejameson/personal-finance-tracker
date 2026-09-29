"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { markAsBillAction } from "@/actions/bills";
import { AmountText } from "@/components/finance/AmountText";
import { Button } from "@/components/ui/button";
import type { Cadence } from "@/lib/recurring/detect";

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Yearly",
};
const CADENCES = Object.keys(CADENCE_LABELS) as Cadence[];

type Props = {
  transactionId: number;
  merchant: string;
  amountCents: number;
  date: string;
  /** Called once the bill row exists (created or already there). */
  onSaved: () => void;
  onCancel: () => void;
};

/**
 * The "Mark as bill…" mini-form shared by the Transactions row and Review.
 * Amount and start date come from the transaction; only the cadence is asked.
 * The select swallows Review's single-key shortcuts because the key guard
 * ignores events from form controls; Escape closes the form from anywhere on
 * the page while it is open.
 */
export function MarkAsBillForm({
  transactionId,
  merchant,
  amountCents,
  date,
  onSaved,
  onCancel,
}: Props) {
  const router = useRouter();
  const uid = useId();
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [pending, start] = useTransition();
  const select = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    select.current?.focus();
  }, []);

  // Escape closes the form wherever focus is, not only from inside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const save = () =>
    start(async () => {
      try {
        const res = await markAsBillAction({ transactionId, cadence });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(res.created ? "Added to Bills" : "Already on Bills", {
          action: {
            label: "View bills",
            onClick: () => router.push("/bills"),
          },
        });
        onSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      }
    });

  return (
    <form
      className="flex flex-wrap items-center gap-3 text-caption"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <span className="text-ink-2">
        Bill from <span className="font-medium text-ink">{merchant}</span> ·{" "}
        <AmountText cents={amountCents} colorize={false} /> · starting{" "}
        <span className="tnum">{date}</span>
      </span>
      <label htmlFor={`${uid}-cadence`} className="text-ink-2">
        Every
      </label>
      <select
        id={`${uid}-cadence`}
        ref={select}
        className="h-8 rounded-control border border-line bg-card px-2 text-caption"
        value={cadence}
        disabled={pending}
        onChange={(e) => setCadence(e.target.value as Cadence)}
      >
        {CADENCES.map((c) => (
          <option key={c} value={c}>
            {CADENCE_LABELS[c]}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={onCancel}
      >
        Cancel
      </Button>
    </form>
  );
}
