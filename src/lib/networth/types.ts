export type Snapshot = { date: string; balanceCents: number };
export const LIABILITY_TYPES = new Set(["credit", "loan"]);
export type AccountBalance = {
  id: number;
  name: string;
  color: string;
  type: string;
  isLiability: boolean;
  balanceCents: number | null;
  asOf: string | null;
};
export type NetWorthPoint = {
  date: string;
  netWorthCents: number;
  assetsCents: number;
  liabilitiesCents: number;
};
export type NetWorthPage = {
  today: string;
  netWorthCents: number;
  assetsCents: number;
  liabilitiesCents: number;
  deltaCents: number | null;
  series: NetWorthPoint[];
  accounts: AccountBalance[];
};
