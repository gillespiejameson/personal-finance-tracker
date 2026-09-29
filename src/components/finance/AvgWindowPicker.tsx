"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { AvgMonths } from "@/lib/insights/page";

const WINDOWS: AvgMonths[] = [3, 6, 12];

/**
 * How many complete months the "Avg" column averages over. The month stays
 * on the URL so the two pickers do not undo each other.
 */
export function AvgWindowPicker({
  month,
  avgMonths,
  basePath,
}: {
  month: string;
  avgMonths: AvgMonths;
  basePath: string;
}) {
  const router = useRouter();
  return (
    <fieldset aria-label="Average window" className="flex gap-1">
      {WINDOWS.map((n) => (
        <Button
          key={n}
          size="sm"
          variant={n === avgMonths ? "default" : "outline"}
          aria-pressed={n === avgMonths}
          onClick={() =>
            router.push(
              `${basePath}?${new URLSearchParams({
                month,
                avg: String(n),
              })}`,
            )
          }
        >
          {n} mo
        </Button>
      ))}
    </fieldset>
  );
}
