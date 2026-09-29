import Link from "next/link";
import { getForecast } from "@/actions/forecast";
import { AmountText } from "@/components/finance/AmountText";
import { ForecastChart } from "@/components/finance/forecast/ForecastChart";
import { ForecastControls } from "@/components/finance/forecast/ForecastControls";
import { UpcomingList } from "@/components/finance/forecast/UpcomingList";
import { Card } from "@/components/ui/card";
import { addDays, monthOf } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days } = await searchParams;
  const page = await getForecast(days);
  const rateLabel =
    page.rate.source === "budget"
      ? "your budget"
      : page.rate.source === "average"
        ? "your average"
        : null;
  const crossesMonth =
    monthOf(page.today) !== monthOf(addDays(page.today, page.days));
  const laterDailyCents = Math.round(page.rate.laterMonthlyCents / 30);

  return (
    <>
      <h1 className="mb-6 text-title font-semibold">Forecast</h1>
      <ForecastControls days={page.days} floorCents={page.floorCents} />

      {!page.hasCash && (
        <Card className="mb-6">
          <p className="text-caption text-ink-2">
            Add a checking balance on{" "}
            <Link href="/networth" className="text-accent underline">
              Net worth
            </Link>{" "}
            to start from your real cash; this starts from $0.
          </p>
        </Card>
      )}

      <Card className="mb-6">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="text-caption text-ink-2">Lowest point</div>
            <AmountText
              cents={page.lowestCents}
              colorize={false}
              size="display"
              className={cn(
                "font-semibold",
                page.belowFloorOn !== null ? "text-negative" : "text-ink",
              )}
            />
            <div className="mt-1 text-caption text-ink-2">
              on {longDate(page.lowestDate)}
            </div>
          </div>
          <div>
            <div className="text-caption text-ink-2">Ends at</div>
            <AmountText
              cents={page.endCents}
              colorize={false}
              size="display"
              className="font-semibold text-ink"
            />
            <div className="mt-1 text-caption text-ink-2">
              on {longDate(page.endDate)}
            </div>
          </div>
        </div>
        <p className="mt-4 text-caption text-ink-2">
          {page.belowFloorOn !== null
            ? page.belowFloorOn === page.lowestDate
              ? `Dips below ${formatCents(page.floorCents, {
                  sign: "never",
                })} on ${longDate(
                  page.belowFloorOn,
                )}, the lowest point (short by ${formatCents(
                  page.shortAtBreachCents,
                  { sign: "never" },
                )}).`
              : `Dips below ${formatCents(page.floorCents, {
                  sign: "never",
                })} on ${longDate(page.belowFloorOn)} (short by ${formatCents(
                  page.shortAtBreachCents,
                  {
                    sign: "never",
                  },
                )}). Lowest point ${formatCents(page.lowestCents, {
                  sign: "never",
                })} on ${longDate(page.lowestDate)}.`
            : `You stay above ${formatCents(page.floorCents, {
                sign: "never",
              })} for the whole period.`}
        </p>
        <p className="mt-2 text-micro text-ink-3">
          Includes only the paychecks and bills the app has detected, plus
          everyday spending at the rate below. Other income and one-off costs
          are not modeled.
        </p>
      </Card>

      <Card className="mb-6">
        <ForecastChart points={page.points} floorCents={page.floorCents} />
      </Card>

      <Card>
        <h2 className="mb-2 text-headline font-semibold">Upcoming</h2>
        <UpcomingList events={page.events} />
        {rateLabel && (
          <p className="mt-3 text-micro text-ink-3">
            {crossesMonth ? (
              <>
                Everyday spending assumed at{" "}
                {formatCents(page.rate.thisMonthDailyCents, {
                  sign: "never",
                })}
                /day this month and{" "}
                {formatCents(laterDailyCents, { sign: "never" })}/day after
                (from {rateLabel})
              </>
            ) : (
              <>
                Everyday spending assumed at{" "}
                {formatCents(page.rate.thisMonthDailyCents, {
                  sign: "never",
                })}
                /day (from {rateLabel})
              </>
            )}
          </p>
        )}
      </Card>
    </>
  );
}
