"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setForecastFloor } from "@/actions/forecast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseAmountToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

const HORIZONS = [30, 60, 90] as const;
type Horizon = (typeof HORIZONS)[number];

function HorizonControl({ days }: { days: Horizon }) {
  const router = useRouter();
  return (
    <div className="inline-flex gap-1 rounded-control bg-subtle p-1">
      {HORIZONS.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={days === d}
          onClick={() => router.replace(`/forecast?days=${d}`)}
          className={cn(
            "rounded-control px-3 py-1.5 text-caption! font-medium transition-colors",
            days === d
              ? "bg-card text-ink shadow-card"
              : "text-ink-2 hover:text-ink",
          )}
        >
          {d} days
        </button>
      ))}
    </div>
  );
}

function FloorInput({ floorCents }: { floorCents: number }) {
  const router = useRouter();
  const [value, setValue] = useState((floorCents / 100).toFixed(2));
  const [pending, start] = useTransition();

  function save() {
    const cents = parseAmountToCents(value);
    if (cents === null || cents < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    start(async () => {
      const r = await setForecastFloor({ cents });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Floor saved");
      router.refresh();
    });
  }

  return (
    <div className="flex items-end gap-2">
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor="forecast-floor-input"
      >
        Keep at least
        <Input
          id="forecast-floor-input"
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.target.select()}
          className="w-28"
        />
      </label>
      <Button disabled={pending} onClick={save}>
        Save
      </Button>
    </div>
  );
}

export function ForecastControls({
  days,
  floorCents,
}: {
  days: Horizon;
  floorCents: number;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <HorizonControl days={days} />
      <FloorInput floorCents={floorCents} />
    </div>
  );
}
