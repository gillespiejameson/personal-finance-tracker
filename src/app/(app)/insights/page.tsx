import { getInsights } from "@/actions/insights";
import { AmountText } from "@/components/finance/AmountText";
import { AvgWindowPicker } from "@/components/finance/AvgWindowPicker";
import { CashFlowWaterfall } from "@/components/finance/charts/CashFlowWaterfall";
import { DeltaCaption } from "@/components/finance/DeltaCaption";
import { InsightsCategoryPanel } from "@/components/finance/InsightsCategoryPanel";
import { MonthPicker } from "@/components/finance/MonthPicker";
import { TopMerchants } from "@/components/finance/TopMerchants";
import { Card } from "@/components/ui/card";
import { PARENT_COLORS } from "@/lib/categories/palette";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; avg?: string }>;
}) {
  const { month, avg } = await searchParams;
  const p = await getInsights(month, avg);
  const strip =
    p.totals.fixed + p.totals.variable + Math.max(p.totals.savings, 0);
  return (
    <>
      <div className="mb-6 flex items-end justify-between">
        <h1 className="text-title font-semibold">Insights</h1>
        <div className="flex items-center gap-4">
          <AvgWindowPicker
            month={p.month}
            avgMonths={p.avgMonths}
            basePath="/insights"
          />
          <MonthPicker
            month={p.month}
            months={p.months}
            basePath="/insights"
            extraParams={{ avg: String(p.avgMonths) }}
          />
        </div>
      </div>
      <div className="grid grid-cols-12 gap-6">
        <Card className="col-span-4">
          <div className="text-caption text-ink-2">Spent</div>
          <AmountText
            cents={p.totals.spent}
            sign="never"
            colorize={false}
            size="display"
            className="font-semibold"
          />
          <DeltaCaption
            now={p.totals.spent}
            before={p.lastTotals.spent}
            partial={p.partialComparison}
            higherIsBetter={false}
          />
        </Card>
        <Card className="col-span-4">
          <div className="text-caption text-ink-2">Income</div>
          <AmountText
            cents={p.totals.income}
            sign="never"
            colorize={false}
            size="display"
            className="font-semibold"
          />
          <DeltaCaption
            now={p.totals.income}
            before={p.lastTotals.income}
            partial={p.partialComparison}
            higherIsBetter={true}
          />
        </Card>
        <Card className="col-span-4">
          <div className="text-caption text-ink-2">Leftover</div>
          <AmountText
            cents={p.totals.leftover}
            size="display"
            className="font-semibold"
          />
          <DeltaCaption
            now={p.totals.leftover}
            before={p.lastTotals.leftover}
            partial={p.partialComparison}
            higherIsBetter={true}
          />
        </Card>
        <InsightsCategoryPanel
          rows={p.breakdown}
          month={p.month}
          totalCents={p.totals.spent}
        >
          <Card className="col-span-7">
            <h2 className="mb-2 text-headline font-semibold">
              Fixed vs variable
            </h2>
            <div className="flex h-4 w-full overflow-hidden rounded-pill bg-subtle">
              <div
                style={{
                  width: `${strip ? Math.max((p.totals.fixed / strip) * 100, 0) : 0}%`,
                  backgroundColor: PARENT_COLORS.home,
                }}
                title="Fixed"
              />
              <div
                style={{
                  width: `${strip ? Math.max((p.totals.variable / strip) * 100, 0) : 0}%`,
                  backgroundColor: PARENT_COLORS.food,
                }}
                title="Variable"
              />
              <div
                style={{
                  width: `${strip ? Math.max((Math.max(p.totals.savings, 0) / strip) * 100, 0) : 0}%`,
                  backgroundColor: PARENT_COLORS.savings,
                }}
                title="Net savings"
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-4 text-caption text-ink-2">
              <div>
                Fixed{" "}
                <AmountText
                  cents={p.totals.fixed}
                  sign="never"
                  colorize={false}
                  size="headline"
                  className="block text-ink"
                />
              </div>
              <div>
                Variable{" "}
                <AmountText
                  cents={p.totals.variable}
                  sign="never"
                  colorize={false}
                  size="headline"
                  className="block text-ink"
                />
              </div>
              <div>
                Net savings{" "}
                <AmountText
                  cents={p.totals.savings}
                  colorize={false}
                  size="headline"
                  className="block text-ink"
                />
              </div>
            </div>
            <h2 className="mt-6 mb-2 text-headline font-semibold">Cash flow</h2>
            <CashFlowWaterfall
              steps={p.waterfall}
              colors={{
                positive: PARENT_COLORS.income,
                negative: PARENT_COLORS.health,
                neutral: PARENT_COLORS.home,
              }}
            />
            <table className="mt-3 w-full text-caption">
              <thead className="text-ink-2">
                <tr>
                  <th className="text-left font-medium">Month</th>
                  <th className="text-right font-medium">Income</th>
                  <th className="text-right font-medium">Fixed</th>
                  <th className="text-right font-medium">Variable</th>
                  <th className="text-right font-medium">Savings</th>
                  <th className="text-right font-medium">Leftover</th>
                </tr>
              </thead>
              <tbody>
                {p.history.map((h) => (
                  <tr key={h.month} className="border-t border-line">
                    <td className="tnum py-1">{h.month}</td>
                    <td className="tnum text-right">
                      {formatCents(h.income, { sign: "never" })}
                    </td>
                    <td className="tnum text-right">
                      {formatCents(h.fixed, { sign: "never" })}
                    </td>
                    <td className="tnum text-right">
                      {formatCents(h.variable, { sign: "never" })}
                    </td>
                    <td className="tnum text-right">
                      {formatCents(h.savings)}
                    </td>
                    <td className="tnum text-right">
                      {formatCents(h.leftover)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </InsightsCategoryPanel>
        <div className="col-span-12">
          <TopMerchants
            byDollars={p.topByDollars}
            byCount={p.topByCount}
            month={p.month}
          />
        </div>
      </div>
    </>
  );
}
