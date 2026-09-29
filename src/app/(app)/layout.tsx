import { Sidebar } from "@/components/shell/Sidebar";
import { Toaster } from "@/components/ui/sonner";
import { budgetGate } from "@/lib/budget/gate";
import { todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import {
  ensurePhase2,
  ensurePhase3,
  ensurePhase7,
  ensurePhase9,
} from "@/lib/maintenance/rerun";
import { queueCount } from "@/lib/review/queue";
import { listWeekStarts } from "@/lib/ritual/store";
import { reviewStatus } from "@/lib/ritual/weeks";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const db = getDb();
  ensurePhase2(db);
  ensurePhase3(db);
  ensurePhase7(db);
  ensurePhase9(db);
  const reviewCount = queueCount(db);
  const gate = budgetGate(db, todayIso());
  const reviewDue = reviewStatus(listWeekStarts(db), todayIso()).due;
  return (
    <div className="flex min-h-screen">
      <Sidebar reviewCount={reviewCount} gate={gate} reviewDue={reviewDue} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] px-6 py-8">{children}</div>
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}
