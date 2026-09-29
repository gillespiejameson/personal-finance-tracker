import { getReviewPage } from "@/actions/review";
import { getWeeklyPage } from "@/actions/weekly";
import { WeeklyReview } from "@/components/finance/ritual/WeeklyReview";

export const dynamic = "force-dynamic";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export default async function WeeklyPageRoute({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { step } = await searchParams;
  const page = await getWeeklyPage();
  const initialStep = clamp(Math.trunc(Number(step)) || 1, 1, 5);
  const review =
    initialStep === 2 && page.queueCount > 0 ? await getReviewPage() : null;
  return <WeeklyReview page={page} review={review} initialStep={initialStep} />;
}
