import Link from "next/link";
import { getAlerts } from "@/actions/alerts";
import { AlertList } from "@/components/finance/alerts/AlertList";

export const dynamic = "force-dynamic";

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ dismissed?: string }>;
}) {
  const { dismissed } = await searchParams;
  const showDismissed = dismissed === "1";
  const { anomalies, dismissedCount, dismissedKeys } = await getAlerts({
    includeDismissed: showDismissed,
  });
  const dismissedSet = new Set(dismissedKeys);
  const liveCount = anomalies.filter((a) => !dismissedSet.has(a.key)).length;
  return (
    <>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-title font-semibold">Worth a look</h1>
          <p className="tnum text-caption text-ink-2">
            {liveCount} item{liveCount === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href={showDismissed ? "/alerts" : "/alerts?dismissed=1"}
          className="text-caption text-accent"
        >
          {showDismissed
            ? "Hide dismissed"
            : `Show dismissed (${dismissedCount})`}
        </Link>
      </div>
      <AlertList anomalies={anomalies} dismissedKeys={dismissedKeys} grouped />
    </>
  );
}
