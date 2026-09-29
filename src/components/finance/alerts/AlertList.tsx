"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { dismissAlert, undismissAlert } from "@/actions/alerts";
import { AmountText } from "@/components/finance/AmountText";
import { Button } from "@/components/ui/button";
import type { Anomaly, AnomalyKind } from "@/lib/anomalies/types";
import { KIND_LABELS } from "@/lib/anomalies/types";

type RunFn = (fn: () => Promise<{ ok: boolean; error?: string }>) => void;

function AlertRow({
  a,
  dismissed,
  pending,
  run,
  bare,
}: {
  a: Anomaly;
  dismissed: boolean;
  pending: boolean;
  run: RunFn;
  bare?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-b-0 ${bare ? "px-0" : "px-5"} ${dismissed ? "opacity-50" : ""}`}
    >
      <span className="shrink-0 rounded-pill bg-subtle px-2 py-0.5 text-micro font-semibold text-ink-2">
        {KIND_LABELS[a.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium">{a.merchant}</div>
        <div className="truncate text-caption text-ink-2">{a.reason}</div>
      </div>
      <div className="tnum shrink-0 text-caption text-ink-3">{a.date}</div>
      <AmountText
        cents={a.amountCents}
        sign="never"
        colorize={false}
        className="shrink-0 font-medium"
      />
      <Link
        href={`/transactions?q=${encodeURIComponent(a.merchant)}&from=${a.date}&to=${a.date}`}
        className="shrink-0 text-caption text-accent"
      >
        View
      </Link>
      {dismissed ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => undismissAlert(a.key))}
        >
          Restore
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => dismissAlert(a.key))}
        >
          Dismiss
        </Button>
      )}
    </div>
  );
}

export function AlertList({
  anomalies,
  dismissedKeys,
  grouped,
  bare,
}: {
  anomalies: Anomaly[];
  dismissedKeys: string[];
  grouped: boolean;
  bare?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const dismissedSet = new Set(dismissedKeys);
  const run: RunFn = (fn) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error ?? "Something went wrong");
        return;
      }
      router.refresh();
    });

  if (anomalies.length === 0) {
    return bare ? (
      <div className="py-8 text-center text-ink-2">
        Nothing worth a look right now.
      </div>
    ) : (
      <div className="rounded-card bg-card p-8 text-center text-ink-2 shadow-card">
        Nothing worth a look right now.
      </div>
    );
  }

  if (!grouped) {
    return (
      <div
        className={
          bare ? "" : "overflow-hidden rounded-card bg-card shadow-card"
        }
      >
        {anomalies.map((a) => (
          <AlertRow
            key={a.key}
            a={a}
            dismissed={dismissedSet.has(a.key)}
            pending={pending}
            run={run}
            bare={bare}
          />
        ))}
      </div>
    );
  }

  const groups = new Map<AnomalyKind, Anomaly[]>();
  for (const a of anomalies) {
    const g = groups.get(a.kind);
    if (g) g.push(a);
    else groups.set(a.kind, [a]);
  }

  return (
    <div className="grid gap-6">
      {[...groups.entries()].map(([kind, items]) => (
        <div key={kind}>
          <h2 className="mb-2 text-headline font-semibold">
            {KIND_LABELS[kind]}
          </h2>
          <div className="overflow-hidden rounded-card bg-card shadow-card">
            {items.map((a) => (
              <AlertRow
                key={a.key}
                a={a}
                dismissed={dismissedSet.has(a.key)}
                pending={pending}
                run={run}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
