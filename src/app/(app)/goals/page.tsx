import { listGoalsAction } from "@/actions/goals";
import { GoalsList } from "@/components/finance/budget/GoalsList";
import { LockedCard } from "@/components/finance/budget/LockedCard";
import { budgetGate } from "@/lib/budget/gate";
import { todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const gate = budgetGate(getDb(), todayIso());
  if (!gate.open) return <LockedCard gate={gate} />;
  const goals = await listGoalsAction();
  return (
    <>
      <h1 className="text-title font-semibold">Goals</h1>
      <p className="mb-6 mt-1 text-caption text-ink-2">
        Each goal is a savings category you fund from the budget.
      </p>
      <GoalsList goals={goals} />
    </>
  );
}
