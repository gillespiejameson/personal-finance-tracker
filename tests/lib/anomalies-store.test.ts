import { describe, expect, it } from "vitest";
import {
  DISMISS_CAP,
  dismiss,
  listDismissed,
  undismiss,
} from "@/lib/anomalies/store";
import { openDb } from "@/lib/db/client";

describe("anomalies dismiss store", () => {
  it("round-trips dismiss and undismiss", () => {
    const db = openDb(":memory:");
    expect(listDismissed(db)).toEqual([]);
    dismiss(db, "merchant-spike:1");
    dismiss(db, "category-spike:2");
    expect(listDismissed(db)).toEqual(["merchant-spike:1", "category-spike:2"]);
    undismiss(db, "merchant-spike:1");
    expect(listDismissed(db)).toEqual(["category-spike:2"]);
  });

  it("re-dismissing an already-dismissed key does not duplicate it", () => {
    const db = openDb(":memory:");
    dismiss(db, "bill-jump:5");
    dismiss(db, "bill-jump:5");
    expect(listDismissed(db)).toEqual(["bill-jump:5"]);
  });

  it("caps the list at the newest 500 keys", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 510; i++) dismiss(db, `merchant-spike:${i}`);
    const list = listDismissed(db);
    expect(list.length).toBe(DISMISS_CAP);
    expect(list[0]).toBe("merchant-spike:10");
    expect(list[list.length - 1]).toBe("merchant-spike:509");
  });
});
