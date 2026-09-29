import { getReviewPage } from "@/actions/review";
import { ReviewScreen } from "@/components/finance/ReviewScreen";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const page = await getReviewPage();
  return (
    <>
      <h1 className="mb-6 text-title font-semibold">Review</h1>
      <ReviewScreen
        items={page.items}
        suggestions={page.suggestions}
        count={page.count}
        categories={page.categories}
      />
    </>
  );
}
