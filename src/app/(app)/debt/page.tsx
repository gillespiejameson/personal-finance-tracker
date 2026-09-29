import Link from "next/link";
import { getDebtPage } from "@/actions/debt";
import { DebtPlanner } from "@/components/finance/debt/DebtPlanner";

export const dynamic = "force-dynamic";

export default async function DebtPage({
  searchParams,
}: {
  searchParams: Promise<{ strategy?: string }>;
}) {
  const { strategy } = await searchParams;
  const page = await getDebtPage(strategy);

  return (
    <>
      <h1 className="mb-6 text-title font-semibold">Debt</h1>

      {page.debts.length === 0 ? (
        <p className="text-caption text-ink-2">
          Add a credit card or loan on{" "}
          <Link href="/accounts" className="text-accent underline">
            Accounts
          </Link>
          , give it a balance on{" "}
          <Link href="/networth" className="text-accent underline">
            Net worth
          </Link>
          , and the plan appears here.
        </p>
      ) : (
        <DebtPlanner page={page} />
      )}
    </>
  );
}
