"use client";
import type { ReviewItem, Suggestion } from "@/actions/review";
import { AmountText } from "@/components/finance/AmountText";
import { CategoryChip } from "@/components/finance/CategoryChip";

type Props = {
  item: ReviewItem;
  suggestions: Suggestion[];
  onSuggestion: (s: Suggestion) => void;
  /** The first M press has landed and the second one will delete this copy. */
  confirmDelete?: boolean;
};

const REASON: Record<ReviewItem["reason"], string> = {
  uncategorized: "Needs a category",
  duplicate: "Possible duplicate",
  refund: "Looks like a refund",
};

export function ReviewCard({
  item,
  suggestions,
  onSuggestion,
  confirmDelete,
}: Props) {
  return (
    <div className="rounded-card bg-card p-6 shadow-card">
      <div className="mb-1 text-caption text-warning">
        {REASON[item.reason]}
      </div>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="truncate text-title font-semibold">
            {item.merchant}
          </div>
          <div
            className="truncate text-caption text-ink-3"
            title={item.rawDescription}
          >
            {item.rawDescription}
          </div>
          <div className="mt-2 flex items-center gap-2 text-caption text-ink-2">
            <span className="tnum">{item.date}</span>
            {item.pending && (
              <span
                className="rounded-pill bg-subtle px-1.5 text-micro font-semibold text-ink-2"
                title="Still pending at the bank; the amount or date can change"
              >
                pending
              </span>
            )}
            <span
              className="size-2 rounded-pill"
              style={{ backgroundColor: item.accountColor }}
            />
            {item.accountName}
          </div>
        </div>
        <AmountText
          cents={item.amountCents}
          size="display"
          className="shrink-0 font-semibold"
        />
      </div>
      {item.refundOf && (
        <div className="mt-4 rounded-control bg-subtle p-3 text-caption">
          Refund of{" "}
          <AmountText cents={item.refundOf.amountCents} colorize={false} /> from{" "}
          {item.refundOf.date}
          {item.refundOf.categoryName ? ` (${item.refundOf.categoryName})` : ""}
          ? Press <kbd>R</kbd> to confirm, <kbd>X</kbd> if not.
        </div>
      )}
      {item.reason === "duplicate" &&
        (confirmDelete ? (
          <div className="mt-4 rounded-control bg-subtle p-3 text-caption font-medium text-warning">
            Press <kbd>M</kbd> again to delete this copy. This cannot be undone.
          </div>
        ) : (
          <div className="mt-4 rounded-control bg-subtle p-3 text-caption">
            Same amount as another charge within 3 days. <kbd>D</kbd> keep both
            · <kbd>M</kbd> twice deletes this copy (not undoable)
          </div>
        ))}
      {suggestions.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {suggestions.map((s, i) => (
            <button
              key={s.categoryId}
              type="button"
              onClick={() => onSuggestion(s)}
              className="flex items-center gap-2 rounded-pill transition-transform hover:scale-105"
            >
              <kbd className="rounded-control bg-subtle px-1.5 text-micro text-ink-2">
                {i + 1}
              </kbd>
              <CategoryChip name={s.name} color={s.color} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
