import { Card } from "@/components/ui/card";
import type { Gate } from "@/lib/budget/types";

export function LockedCard({ gate }: { gate: Gate }) {
  return (
    <Card>
      <h1 className="text-headline font-semibold">
        Budget unlocks after {gate.needed} full months of data (
        {gate.completeMonths}/{gate.needed})
      </h1>
      <p className="mt-2 text-body text-ink-2">
        Keep importing statements — once two calendar months are complete, you
        can build a budget from your real spending.
      </p>
    </Card>
  );
}
