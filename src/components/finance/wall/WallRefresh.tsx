"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** The wall is a passive screen: re-render it on a timer so it never goes stale. */
export function WallRefresh({ everyMs = 5 * 60 * 1000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
