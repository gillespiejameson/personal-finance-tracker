import { getBills } from "@/actions/bills";
import { listIrregular, listPlannedCategoryOptions } from "@/actions/spreading";
import { BillsList } from "@/components/finance/BillsList";
import { IrregularExpenses } from "@/components/finance/spreading/IrregularExpenses";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ dismissed?: string }>;
}) {
  const { dismissed } = await searchParams;
  const showDismissed = dismissed === "1";
  const { bills, monthlyTotalCents, expectedIncomeMonthlyCents, categories } =
    await getBills({ includeDismissed: showDismissed });
  const { items: irregular } = await listIrregular();
  const plannedCategories = await listPlannedCategoryOptions();
  const live = bills.filter(
    (b) => b.active && !b.dismissed && !b.isIncome,
  ).length;
  return (
    <>
      <div className="mb-6">
        <h1 className="text-title font-semibold">Bills</h1>
        <p className="tnum text-caption text-ink-2">
          {live} recurring charge{live === 1 ? "" : "s"} ·{" "}
          {formatCents(monthlyTotalCents, { sign: "never" })}/mo
          {expectedIncomeMonthlyCents > 0
            ? ` · expected income ${formatCents(expectedIncomeMonthlyCents, { sign: "never" })}/mo`
            : ""}
        </p>
      </div>
      <BillsList
        bills={bills}
        categories={categories}
        showDismissed={showDismissed}
      />
      <div className="mt-6">
        <IrregularExpenses items={irregular} categories={plannedCategories} />
      </div>
    </>
  );
}
