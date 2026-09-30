# Transaction split labels at narrow widths

Regression test for [#21](https://github.com/gillespiejameson/personal-finance-tracker/issues/21).
This checks rendered browser layout, which the Node-only Vitest suite cannot measure.

## Setup

1. Use Node 24 and install the locked dependencies with `npm ci`.
2. Set `FINANCE_DB` to a separate development database, then run `npm run seed`
   and `npm run dev`. Seeding wipes that database; use made-up data only.
3. On **Review**, split a seeded transaction into two categories. The amounts
   must add up to the original amount. For example, split a seeded $1,650 rent
   transaction into $1,000 and $650.
4. On **Transactions**, search for that merchant and expand **Split · 2**.

## Checks

At browser viewport widths of **800**, **1200**, and **1440** pixels:

- Every split label remains visible, occupies one line and fits inside its 28px row.
- A clipped label exposes the complete `Split line N` text in its title.
- Category and amount columns line up with the parent transaction.
- Widening the viewport shows the complete label when there is enough space.
- Collapsing and expanding the transaction restores both split rows correctly.

At narrow widths, use the table's existing horizontal scrollbar to inspect the
amount column. The shared merchant column must not collapse to zero width.

Keep the transaction expanded while resizing. Run this read-only check in the
browser console at each width; it measures the actual text rather than matching
CSS utility names:

```js
const labels = [...document.querySelectorAll("span")].filter((element) =>
  /^Split line \d+$/.test(element.textContent.trim()),
);
if (labels.length < 2) throw new Error("Expand a transaction with at least two splits.");

for (const label of labels) {
  const row = label.parentElement;
  const parentRow = row.parentElement.parentElement.firstElementChild;
  const bounds = label.getBoundingClientRect();
  const rowBounds = row.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(label);
  const lineTops = new Set([...range.getClientRects()].map((rect) => rect.top));

  // A wrapped label exceeds the fixed row height and overlaps its neighbours.
  if (bounds.width <= 0 || lineTops.size !== 1 || bounds.top < rowBounds.top || bounds.bottom > rowBounds.bottom)
    throw new Error(`${label.textContent.trim()} wraps or overflows its row.`);
  if (label.title !== label.textContent.trim())
    throw new Error("A truncated label must retain its full text in the title.");

  const categoryOffset = Math.abs(
    row.children[2].getBoundingClientRect().left -
      parentRow.children[2].getBoundingClientRect().left,
  );
  const amountOffset = Math.abs(
    row.children[4].getBoundingClientRect().right -
      parentRow.children[4].getBoundingClientRect().right,
  );
  if (categoryOffset > 1 || amountOffset > 1)
    throw new Error("Split categories or amounts are misaligned.");
}
console.log(`Passed: ${labels.length} split labels fit and align.`);
```

Before the fix, the 800px case renders three text lines (54px) inside each
28px row and fails the overflow check. With the fix, each label is 18px tall.
Also run `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run build`
before submitting a PR.
