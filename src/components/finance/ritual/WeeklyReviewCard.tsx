import Link from "next/link";
import { Card } from "@/components/ui/card";
import type { ReviewStatus } from "@/lib/ritual/types";
import { cn } from "@/lib/utils";

const daysAgo = (n: number) => `${n} day${n === 1 ? "" : "s"} ago`;

function statusLine(status: ReviewStatus): { text: string; color: string } {
  if (status.doneThisWeek) {
    return { text: "Done this week", color: "text-positive" };
  }
  if (status.due) {
    return {
      text:
        status.daysSince === null
          ? "Due · never reviewed"
          : `Due · last reviewed ${daysAgo(status.daysSince)}`,
      color: "text-warning",
    };
  }
  return {
    text:
      status.daysSince === null
        ? "Last reviewed recently"
        : `Last reviewed ${daysAgo(status.daysSince)}`,
    color: "text-ink-2",
  };
}

export function WeeklyReviewCard({
  status,
  className,
}: {
  status: ReviewStatus;
  className?: string;
}) {
  const streakLine =
    status.streak > 0 ? `${status.streak}-week streak` : "No streak yet";
  const { text, color } = statusLine(status);
  const buttonLabel = status.doneThisWeek
    ? "Review again"
    : status.due
      ? "Start review"
      : "Open review";
  return (
    <Card className={className}>
      <h2 className="text-headline font-semibold">Weekly review</h2>
      <p className="mt-1 text-caption text-ink-2">{streakLine}</p>
      <p className={cn("mt-2 text-body font-medium", color)}>{text}</p>
      <Link
        href="/weekly"
        className="mt-4 inline-block rounded-control bg-accent px-5 py-2.5 text-body font-medium text-white"
      >
        {buttonLabel}
      </Link>
    </Card>
  );
}
