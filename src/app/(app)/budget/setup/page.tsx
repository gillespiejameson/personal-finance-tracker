import { getBudgetSetup } from "@/actions/budget";
import { BudgetSetup } from "@/components/finance/budget/BudgetSetup";
import { LockedCard } from "@/components/finance/budget/LockedCard";

export const dynamic = "force-dynamic";

const monthLabel = (m: string) =>
  new Date(`${m}-15T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

export default async function BudgetSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const s = await getBudgetSetup(month);
  if (!s.gate.open) return <LockedCard gate={s.gate} />;
  return (
    <>
      <div className="mb-6">
        <h1 className="text-title font-semibold">
          Set up {monthLabel(s.month)}
        </h1>
        <p className="mt-1 text-caption text-ink-2">
          Prefilled from your last {s.avgMonths} complete month
          {s.avgMonths === 1 ? "" : "s"}
        </p>
      </div>
      <BudgetSetup setup={s} />
    </>
  );
}
