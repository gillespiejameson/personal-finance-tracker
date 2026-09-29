import { cookies } from "next/headers";
import Link from "next/link";
import { WallPanel } from "@/components/finance/wall/WallPanel";
import { WallRefresh } from "@/components/finance/wall/WallRefresh";
import { getDb } from "@/lib/db/client";
import { isAuthorizedDisplay } from "@/lib/wall/auth";
import { loadWallSummary } from "@/lib/wall/load";
import { DEVICE_COOKIE } from "@/lib/wall/types";

export const dynamic = "force-dynamic";

export default async function WallPage() {
  const db = getDb();
  const token = (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
  const ok = isAuthorizedDisplay(db, {
    authorization: null,
    cookie: token ? `${DEVICE_COOKIE}=${encodeURIComponent(token)}` : null,
  });
  if (!ok)
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas p-10">
        <div className="rounded-card bg-card p-8 text-center shadow-card">
          <h1 className="mb-2 text-headline font-semibold">
            This display is not enrolled
          </h1>
          <p className="text-caption text-ink-2">
            Generate a display token in{" "}
            <Link href="/settings" className="text-accent">
              Settings &rarr; Household
            </Link>{" "}
            and open its enrollment link here once.
          </p>
        </div>
      </main>
    );
  return (
    <main className="min-h-screen bg-canvas">
      <WallPanel summary={loadWallSummary(db, new Date())} />
      <WallRefresh />
    </main>
  );
}
