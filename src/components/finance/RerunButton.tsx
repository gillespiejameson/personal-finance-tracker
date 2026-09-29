"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { rerunDetectionAction } from "@/actions/review";
import { Button } from "@/components/ui/button";

export function RerunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await rerunDetectionAction();
          toast.success(
            `Updated ${r.merchantsUpdated} merchants · reset ${r.transfersReset} transfers · categorized ${r.categorized} · linked ${r.refundsLinked} refunds · ${r.recurringDetected} recurring`,
          );
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Re-running…" : "Re-run detection"}
    </Button>
  );
}
