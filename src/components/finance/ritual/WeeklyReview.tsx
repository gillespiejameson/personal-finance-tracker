"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeWeeklyReview } from "@/actions/weekly";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { addDays } from "@/lib/dates";
import type { WeeklyPage } from "@/lib/ritual/types";
import { STEP_COUNT, StepRail } from "./StepRail";
import {
  AdjustStep,
  BillsStep,
  ImportStep,
  PaceStep,
  QueueStep,
  type ReviewData,
} from "./steps";

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

export function WeeklyReview({
  page,
  review,
  initialStep,
}: {
  page: WeeklyPage;
  review: ReviewData;
  initialStep: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [pending, start] = useTransition();
  const [finished, setFinished] = useState<{ streak: number } | null>(null);
  const [showBanner] = useState(page.status.doneThisWeek);

  const goTo = (n: number) => {
    const clamped = Math.min(STEP_COUNT, Math.max(1, n));
    setStep(clamped);
    router.replace(`/weekly?step=${clamped}`, { scroll: false });
  };

  const finish = () => {
    start(async () => {
      const res = await completeWeeklyReview();
      setFinished({ streak: res.streak });
      router.refresh();
    });
  };

  if (finished) {
    // The completion date is today (local); the next review is due 7 days
    // after that, matching `reviewStatus.due` (7 days after last completion).
    const next = addDays(page.today, 7);
    return (
      <Card className="mx-auto max-w-md text-center">
        <h1 className="text-title font-semibold">
          Reviewed. {finished.streak}-week streak.
        </h1>
        <p className="mt-2 text-body text-ink-2">
          Next one is due {shortDate(next)}
        </p>
        <Link
          href="/home"
          className="mt-4 inline-block rounded-control bg-accent px-5 py-2.5 text-body font-medium text-white"
        >
          Home
        </Link>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-title font-semibold">Weekly review</h1>
      {showBanner && (
        <div className="rounded-card bg-subtle px-4 py-3 text-caption text-ink-2">
          Already reviewed this week — going through it again is fine.
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <StepRail step={step} onSelect={goTo} queueCount={page.queueCount} />
        </div>
        <div className="grid gap-4 lg:col-span-9">
          {step === 1 && <ImportStep accounts={page.accounts} />}
          {step === 2 && (
            <QueueStep review={review} queueCount={page.queueCount} />
          )}
          {step === 3 && (
            <PaceStep
              pace={page.pace}
              overspent={page.overspent}
              warn={page.warn}
              gateOpen={page.gateOpen}
              hasBudget={page.hasBudget}
              month={page.month}
              alertCount={page.alertCount}
            />
          )}
          {step === 4 && <BillsStep bills={page.bills} />}
          {step === 5 && (
            <AdjustStep
              budgetLeftToAssign={page.budgetLeftToAssign}
              goals={page.goals}
            />
          )}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              disabled={step === 1}
              onClick={() => goTo(step - 1)}
            >
              Back
            </Button>
            {step < STEP_COUNT ? (
              <Button onClick={() => goTo(step + 1)}>Continue</Button>
            ) : (
              <Button disabled={pending} onClick={finish}>
                Finish review
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
