import Link from "next/link";
import { Card } from "@/components/ui/card";
import { monthEnd } from "@/lib/dates";
import type { MerchantStat } from "@/lib/insights/merchants";

function MerchantList({
  rows,
  month,
}: {
  rows: MerchantStat[];
  month: string;
}) {
  if (rows.length === 0) {
    return <p className="text-caption text-ink-3">No merchants this month.</p>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {rows.map((m) => (
        <li key={m.merchant}>
          <Link
            href={`/transactions?q=${encodeURIComponent(m.merchant)}&from=${month}-01&to=${monthEnd(month)}`}
            className="block rounded-control px-2 py-1.5 text-caption text-ink hover:bg-subtle"
          >
            {m.phrase}
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function TopMerchants({
  byDollars,
  byCount,
  month,
}: {
  byDollars: MerchantStat[];
  byCount: MerchantStat[];
  month: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <Card>
        <h2 className="mb-2 text-headline font-semibold">
          Top merchants by amount
        </h2>
        <MerchantList rows={byDollars} month={month} />
      </Card>
      <Card>
        <h2 className="mb-2 text-headline font-semibold">
          Top merchants by frequency
        </h2>
        <MerchantList rows={byCount} month={month} />
      </Card>
    </div>
  );
}
