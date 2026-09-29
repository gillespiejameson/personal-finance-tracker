"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { syncNowAction } from "@/actions/simplefin";
import { changedAnything, summarize } from "@/lib/simplefin/summary";

/**
 * Fires at most one automatic sync per page load: the ref is set before the
 * request, so neither Strict Mode's double effect nor the `router.refresh()`
 * that follows can start a second one.
 *
 * The nudge is quiet by design. Whether to sync at all is the server's call
 * (`shouldAutoSync`), and a failure says nothing here — the Home caption
 * carries "Sync needs attention" on the next render instead, so a bank that
 * is down cannot follow the user around with toasts.
 */
export function SyncNudge({ shouldAutoSync }: { shouldAutoSync: boolean }) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (!shouldAutoSync) return;
    fired.current = true;
    void (async () => {
      const outcome = await syncNowAction({ automatic: true });
      if (outcome.ok && changedAnything(outcome.results))
        toast.success(summarize(outcome.results));
      router.refresh();
    })();
  }, [shouldAutoSync, router]);

  return null;
}
