import { describe, expect, it } from "vitest";
import { detectAnomalies, meanStd, median } from "@/lib/anomalies/detect";
import type { Line } from "@/lib/insights/lines";
import type { Bill } from "@/lib/recurring/refresh";

const TODAY = "2026-09-06";

function line(
  p: Partial<Line> & Pick<Line, "txnId" | "date" | "amountCents">,
): Line {
  return {
    month: p.date.slice(0, 7),
    merchant: "Merchant",
    accountId: 1,
    categoryId: null,
    leafName: "Uncategorized",
    leafSeedKey: null,
    isFixed: false,
    parentId: null,
    parentName: "Uncategorized",
    parentSeedKey: null,
    parentKind: "system",
    color: "#C7C7CC",
    ...p,
  };
}

function bill(p: Partial<Bill>): Bill {
  return {
    id: 1,
    merchant: "Bill Co",
    categoryId: null,
    categoryName: null,
    color: null,
    cadence: "monthly",
    intervalDays: 30,
    avgCents: -10000,
    monthlyCents: 10000,
    occurrences: 6,
    firstSeen: "2026-01-01",
    lastSeen: "2026-08-06",
    nextExpected: "2026-09-06",
    dueInDays: 0,
    isNew: false,
    active: true,
    dismissed: false,
    recentAmounts: [],
    confidence: "confirmed",
    manual: false,
    isIncome: false,
    ...p,
  };
}

describe("median", () => {
  it("averages the two middle values for even-length lists", () => {
    expect(median([1, 3])).toBe(2);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBe(0);
  });
});

describe("meanStd", () => {
  it("computes population mean and standard deviation", () => {
    expect(meanStd([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({ mean: 5, std: 2 });
    expect(meanStd([])).toEqual({ mean: 0, std: 0 });
  });
});

describe("detectAnomalies: merchant-spike", () => {
  const earlier = [1, 2, 3].map((n) =>
    line({
      txnId: n,
      date: `2026-0${n}-10`,
      amountCents: -1000,
      merchant: "Bob's Diner",
    }),
  );

  it("does not fire at 2.9x the median", () => {
    const out = detectAnomalies({
      lines: [
        ...earlier,
        line({
          txnId: 10,
          date: "2026-09-01",
          amountCents: -2900,
          merchant: "bob's diner",
        }),
      ],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    expect(out.some((a) => a.kind === "merchant-spike")).toBe(false);
  });

  it("fires at 3x the median with a reason naming the ratio and usual amount", () => {
    const out = detectAnomalies({
      lines: [
        ...earlier,
        line({
          txnId: 11,
          date: "2026-09-01",
          amountCents: -3000,
          merchant: "bob's diner",
        }),
      ],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    const a = out.find((x) => x.kind === "merchant-spike" && x.txnId === 11);
    expect(a).toBeDefined();
    expect(a?.reason).toMatch(/3\.0×/);
    expect(a?.reason).toMatch(/\$10\.00/);
  });
});

describe("detectAnomalies: category-spike", () => {
  const cat = 5;
  const dates9 = [
    "2026-06-10",
    "2026-06-20",
    "2026-07-01",
    "2026-07-10",
    "2026-07-20",
    "2026-08-01",
    "2026-08-10",
    "2026-08-15",
    "2026-08-20",
  ];
  const amounts9 = [4000, 4200, 3800, 4100, 3900, 4050, 3950, 4000, 4300];
  const baseline9 = dates9.map((d, idx) =>
    line({
      txnId: 100 + idx,
      date: d,
      amountCents: -amounts9[idx],
      categoryId: cat,
      leafName: "Groceries",
      merchant: `Store ${idx}`,
    }),
  );
  // Merchant matches an existing baseline row (not a first-ever merchant) so
  // this stays a pure category-spike case, unaffected by new-merchant
  // suppression.
  const spike = line({
    txnId: 200,
    date: "2026-09-01",
    amountCents: -20000,
    categoryId: cat,
    leafName: "Groceries",
    merchant: "Store 0",
  });

  it("does not fire with only 9 prior rows in the 90-day window", () => {
    const out = detectAnomalies({
      lines: [...baseline9, spike],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    expect(out.some((a) => a.kind === "category-spike")).toBe(false);
  });

  it("fires once a 10th prior row is in the 90-day window", () => {
    const baseline10 = [
      ...baseline9,
      line({
        txnId: 109,
        date: "2026-08-25",
        amountCents: -4000,
        categoryId: cat,
        leafName: "Groceries",
        merchant: "Store 9",
      }),
    ];
    const out = detectAnomalies({
      lines: [...baseline10, spike],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    const a = out.find((x) => x.kind === "category-spike" && x.txnId === 200);
    expect(a).toBeDefined();
    expect(a?.reason).toContain("Groceries");
  });

  it("is suppressed when merchant-spike already fired for the same transaction", () => {
    const merchantEarlier = [1, 2, 3].map((n) =>
      line({
        txnId: 300 + n,
        date: `2026-0${n}-10`,
        amountCents: -1000,
        merchant: "Suppressed Co",
        categoryId: cat,
        leafName: "Groceries",
      }),
    );
    const catBaseline = [...dates9, "2026-08-25"].map((d, idx) =>
      line({
        txnId: 400 + idx,
        date: d,
        amountCents: -[...amounts9, 4000][idx],
        categoryId: cat,
        leafName: "Groceries",
        merchant: `Other ${idx}`,
      }),
    );
    const both = line({
      txnId: 500,
      date: "2026-09-01",
      amountCents: -20000,
      merchant: "suppressed co",
      categoryId: cat,
      leafName: "Groceries",
    });
    const out = detectAnomalies({
      lines: [...merchantEarlier, ...catBaseline, both],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    expect(
      out.some((a) => a.txnId === 500 && a.kind === "merchant-spike"),
    ).toBe(true);
    expect(
      out.some((a) => a.txnId === 500 && a.kind === "category-spike"),
    ).toBe(false);
  });
});

describe("detectAnomalies: new-merchant suppresses category-spike", () => {
  it("suppresses category-spike when new-merchant fires for the same transaction", () => {
    const cat = 9;
    const dates = [
      "2026-06-10",
      "2026-06-20",
      "2026-07-01",
      "2026-07-10",
      "2026-07-20",
      "2026-08-01",
      "2026-08-10",
      "2026-08-15",
      "2026-08-20",
      "2026-08-25",
    ];
    const amounts = [
      4000, 4200, 3800, 4100, 3900, 4050, 3950, 4000, 4300, 4000,
    ];
    const baseline = dates.map((d, idx) =>
      line({
        txnId: 900 + idx,
        date: d,
        amountCents: -amounts[idx],
        categoryId: cat,
        leafName: "Dining",
        merchant: `Old Place ${idx}`,
      }),
    );
    const spike = line({
      txnId: 950,
      date: "2026-09-01",
      amountCents: -30000,
      categoryId: cat,
      leafName: "Dining",
      merchant: "Brand New Bistro",
    });
    const out = detectAnomalies({
      lines: [...baseline, spike],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    expect(out.some((a) => a.txnId === 950 && a.kind === "new-merchant")).toBe(
      true,
    );
    expect(
      out.some((a) => a.txnId === 950 && a.kind === "category-spike"),
    ).toBe(false);
  });
});

describe("detectAnomalies: new-merchant considers income lines too", () => {
  it("does not fire when an earlier income line exists at the same merchant", () => {
    const out = detectAnomalies({
      lines: [
        line({
          txnId: 1200,
          date: "2026-08-01",
          amountCents: 50000,
          merchant: "Side Gig LLC",
        }),
        line({
          txnId: 1201,
          date: "2026-09-02",
          amountCents: -25000,
          merchant: "side gig llc",
        }),
      ],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    expect(out.some((a) => a.kind === "new-merchant")).toBe(false);
  });
});

describe("detectAnomalies: new-merchant", () => {
  it("does not fire at $199", () => {
    const out = detectAnomalies({
      lines: [
        line({
          txnId: 600,
          date: "2026-09-02",
          amountCents: -19900,
          merchant: "Brand New Shop",
        }),
      ],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    expect(out.some((a) => a.kind === "new-merchant")).toBe(false);
  });

  it("fires at $200 with a fixed reason", () => {
    const out = detectAnomalies({
      lines: [
        line({
          txnId: 601,
          date: "2026-09-02",
          amountCents: -20000,
          merchant: "Brand New Shop 2",
        }),
      ],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    const a = out.find((x) => x.kind === "new-merchant" && x.txnId === 601);
    expect(a).toBeDefined();
    expect(a?.reason).toBe("First time at this merchant");
  });
});

describe("detectAnomalies: bill-jump", () => {
  it("does not fire at 14% above average", () => {
    const out = detectAnomalies({
      lines: [
        line({
          txnId: 700,
          date: "2026-09-01",
          amountCents: -11400,
          merchant: "streaming co",
        }),
      ],
      bills: [
        bill({
          merchant: "Streaming Co",
          avgCents: -10000,
          lastSeen: "2026-09-01",
        }),
      ],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    expect(out.some((a) => a.kind === "bill-jump")).toBe(false);
  });

  it("fires at 16% above average with both amounts in the reason", () => {
    const out = detectAnomalies({
      lines: [
        line({
          txnId: 701,
          date: "2026-09-01",
          amountCents: -11600,
          merchant: "streaming co",
        }),
      ],
      bills: [
        bill({
          merchant: "Streaming Co",
          avgCents: -10000,
          lastSeen: "2026-09-01",
        }),
      ],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    const a = out.find((x) => x.kind === "bill-jump" && x.txnId === 701);
    expect(a).toBeDefined();
    expect(a?.reason).toMatch(/\$116\.00/);
    expect(a?.reason).toMatch(/\$100\.00/);
  });
});

describe("detectAnomalies: bill-jump respects the recent window", () => {
  it("does not fire when the jumped charge is outside the 30-day window", () => {
    const out = detectAnomalies({
      lines: [
        line({
          txnId: 1100,
          date: "2026-07-28", // today - 40 days
          amountCents: -13000, // 30% above avgCents
          merchant: "old streaming co",
        }),
      ],
      bills: [
        bill({
          merchant: "Old Streaming Co",
          avgCents: -10000,
          lastSeen: "2026-07-28",
        }),
      ],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    expect(out.some((a) => a.kind === "bill-jump")).toBe(false);
  });
});

describe("detectAnomalies: double-charge", () => {
  it("does not fire 3 days apart", () => {
    const out = detectAnomalies({
      lines: [
        line({
          txnId: 800,
          date: "2026-09-01",
          amountCents: -5000,
          merchant: "Coffee Shop",
        }),
        line({
          txnId: 801,
          date: "2026-09-04",
          amountCents: -5000,
          merchant: "Coffee Shop",
        }),
      ],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    expect(out.some((a) => a.kind === "double-charge")).toBe(false);
  });

  it("fires 2 days apart, reported once on the later transaction", () => {
    const out = detectAnomalies({
      lines: [
        line({
          txnId: 802,
          date: "2026-09-01",
          amountCents: -5000,
          merchant: "Coffee Shop",
        }),
        line({
          txnId: 803,
          date: "2026-09-03",
          amountCents: -5000,
          merchant: "Coffee Shop",
        }),
      ],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    const matches = out.filter((a) => a.kind === "double-charge");
    expect(matches.length).toBe(1);
    expect(matches[0].txnId).toBe(803);
    expect(matches[0].reason).toMatch(/2 days apart/);
  });

  it("fires on the same day with 'same day' wording", () => {
    const out = detectAnomalies({
      lines: [
        line({
          txnId: 810,
          date: "2026-09-01",
          amountCents: -5000,
          merchant: "Coffee Shop",
        }),
        line({
          txnId: 811,
          date: "2026-09-01",
          amountCents: -5000,
          merchant: "Coffee Shop",
        }),
      ],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    const matches = out.filter((a) => a.kind === "double-charge");
    expect(matches.length).toBe(1);
    expect(matches[0].reason).toBe(
      "Same amount at the same merchant on the same day",
    );
  });

  it("does not fire below the $20 minimum", () => {
    const out = detectAnomalies({
      lines: [
        line({
          txnId: 820,
          date: "2026-09-01",
          amountCents: -1150,
          merchant: "Small Shop",
        }),
        line({
          txnId: 821,
          date: "2026-09-02",
          amountCents: -1150,
          merchant: "Small Shop",
        }),
      ],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    expect(out.some((a) => a.kind === "double-charge")).toBe(false);
  });

  it("fires at $25, above the minimum", () => {
    const out = detectAnomalies({
      lines: [
        line({
          txnId: 822,
          date: "2026-09-01",
          amountCents: -2500,
          merchant: "Mid Shop",
        }),
        line({
          txnId: 823,
          date: "2026-09-02",
          amountCents: -2500,
          merchant: "Mid Shop",
        }),
      ],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    expect(out.some((a) => a.kind === "double-charge" && a.txnId === 823)).toBe(
      true,
    );
  });

  it("skips a pair already marked possibleDuplicate", () => {
    const out = detectAnomalies({
      lines: [
        line({
          txnId: 804,
          date: "2026-09-01",
          amountCents: -5000,
          merchant: "Coffee Shop",
        }),
        line({
          txnId: 805,
          date: "2026-09-02",
          amountCents: -5000,
          merchant: "Coffee Shop",
        }),
      ],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set([805]),
    });
    expect(out.some((a) => a.kind === "double-charge")).toBe(false);
  });
});

describe("detectAnomalies: 30-day window", () => {
  it("ignores an otherwise anomaly-worthy transaction older than 30 days", () => {
    const earlier = [1, 2, 3].map((n) =>
      line({
        txnId: n,
        date: `2026-0${n}-10`,
        amountCents: -1000,
        merchant: "Old Merchant",
      }),
    );
    const old = line({
      txnId: 900,
      date: "2026-08-06", // today - 31 days
      amountCents: -5000,
      merchant: "old merchant",
    });
    const out = detectAnomalies({
      lines: [...earlier, old],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    expect(out.some((a) => a.txnId === 900)).toBe(false);
  });
});

describe("detectAnomalies: ordering", () => {
  it("sorts by score, highest first", () => {
    const low = line({
      txnId: 1000,
      date: "2026-09-01",
      amountCents: -20000,
      merchant: "New Low",
    });
    const high = line({
      txnId: 1001,
      date: "2026-09-01",
      amountCents: -60000,
      merchant: "New High",
    });
    const out = detectAnomalies({
      lines: [low, high],
      bills: [],
      today: TODAY,
      possibleDuplicateIds: new Set(),
    });
    expect(out.map((a) => a.txnId)).toEqual([1001, 1000]);
  });
});
