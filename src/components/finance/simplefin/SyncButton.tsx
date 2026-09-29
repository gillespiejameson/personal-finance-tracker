"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { syncNowAction } from "@/actions/simplefin";
import { Button } from "@/components/ui/button";
import { summarize } from "@/lib/simplefin/summary";

export function SyncButton({
  size = "sm",
  variant = "outline",
}: {
  size?: "sm" | "default";
  variant?: "outline" | "default";
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      disabled={busy}
      onClick={() =>
        start(async () => {
          const outcome = await syncNowAction({ automatic: false });
          if (outcome.ok) toast.success(summarize(outcome.results));
          else toast.error(outcome.error);
          // Windows can commit before a later one fails, so refresh either way.
          router.refresh();
        })
      }
    >
      {busy ? "Syncing…" : "Sync now"}
    </Button>
  );
}
