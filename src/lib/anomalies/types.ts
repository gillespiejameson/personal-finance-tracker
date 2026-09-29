export type AnomalyKind =
  | "merchant-spike"
  | "category-spike"
  | "new-merchant"
  | "bill-jump"
  | "double-charge";
export type Anomaly = {
  key: string;
  kind: AnomalyKind;
  txnId: number;
  date: string;
  merchant: string;
  amountCents: number; // signed as stored (negative outflow)
  categoryName: string | null;
  reason: string;
  score: number;
};
export type AlertsPage = {
  today: string;
  anomalies: Anomaly[];
  dismissedCount: number;
};
export const KIND_LABELS: Record<AnomalyKind, string> = {
  "merchant-spike": "Large for this merchant",
  "category-spike": "Large for its category",
  "new-merchant": "New merchant, big charge",
  "bill-jump": "Bill jumped",
  "double-charge": "Possible double charge",
};
