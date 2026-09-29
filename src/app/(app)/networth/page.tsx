import { getNetWorthPage } from "@/actions/networth";
import { AmountText } from "@/components/finance/AmountText";
import { BalanceList } from "@/components/finance/networth/BalanceList";
import { NetWorthChart } from "@/components/finance/networth/NetWorthChart";
import { Card } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function NetWorthPage() {
  const page = await getNetWorthPage();

  return (
    <>
      <h1 className="mb-6 text-title font-semibold">Net worth</h1>

      {page.series.length === 0 && (
        <p className="mb-6 text-caption text-ink-2">
          Balances appear after your next import. Add one now for any account.
        </p>
      )}

      <Card className="mb-6">
        <div className="text-caption text-ink-2">Net worth</div>
        <AmountText
          cents={page.netWorthCents}
          colorize={false}
          size="display"
          className="font-semibold"
        />
        <div className="tnum mt-1 text-caption text-ink-2">
          {formatCents(page.assetsCents, { sign: "never" })} assets ·{" "}
          {formatCents(page.liabilitiesCents, { sign: "never" })} liabilities
        </div>
        {page.deltaCents !== null && (
          <div
            className={cn(
              "tnum mt-1 text-caption",
              page.deltaCents >= 0 ? "text-positive" : "text-negative",
            )}
          >
            {page.deltaCents >= 0 ? "+" : "−"}
            {formatCents(Math.abs(page.deltaCents), { sign: "never" })} vs 30
            days ago
          </div>
        )}
      </Card>

      <Card className="mb-6">
        <NetWorthChart series={page.series} />
      </Card>

      <p className="mb-3 text-caption text-ink-2">
        Statements with a balance column update these automatically; add a
        balance by hand for anything else.
      </p>
      <BalanceList accounts={page.accounts} today={page.today} />
    </>
  );
}
