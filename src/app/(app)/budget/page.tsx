import Link from "next/link";
import { getBudgetPage } from "@/actions/budget";
import {
  BudgetTable,
  CopyLastMonthButton,
} from "@/components/finance/budget/BudgetTable";
import { LockedCard } from "@/components/finance/budget/LockedCard";
import { MonthPicker } from "@/components/finance/MonthPicker";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const monthLabel = (m: string) =>
  new Date(`${m}-15T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

function SetupCard({
  month,
  prevHasBudget,
}: {
  month: string;
  prevHasBudget: boolean;
}) {
  return (
    <Card>
      <h1 className="mb-1 text-headline font-semibold">Budget</h1>
      <p className="text-body text-ink-2">
        No budget for {monthLabel(month)} yet.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <Link
          href={`/budget/setup?month=${month}`}
          className="inline-block rounded-control bg-accent px-5 py-2.5 text-body font-medium text-white"
        >
          Start from your averages
        </Link>
        {prevHasBudget && <CopyLastMonthButton month={month} />}
      </div>
    </Card>
  );
}

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const p = await getBudgetPage(month);
  if (!p.gate.open) return <LockedCard gate={p.gate} />;
  if (!p.hasBudget)
    return <SetupCard month={p.month} prevHasBudget={p.prevHasBudget} />;
  return (
    <>
      <div className="mb-6 flex items-end justify-between">
        <h1 className="text-title font-semibold">Budget</h1>
        <MonthPicker month={p.month} months={p.months} basePath="/budget" />
      </div>
      <BudgetTable page={p} />
    </>
  );
}
