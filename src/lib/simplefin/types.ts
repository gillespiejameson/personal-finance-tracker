/** Shapes from the SimpleFIN protocol (simplefin.org/protocol) and this app's view of a connection. */

/** A field a bridge has nothing for arrives as `null` as often as it is missing. */
export type SfinTransaction = {
  id: string;
  /** Unix seconds; 0 while the transaction is pending. */
  posted: number;
  /** Numeric string, deposits positive. */
  amount: string;
  description?: string | null;
  payee?: string | null;
  memo?: string | null;
  pending?: boolean | null;
  transacted_at?: number | null;
};

export type SfinAccount = {
  id: string;
  org?: { domain?: string | null; name?: string | null } | null;
  name: string;
  currency: string;
  balance: string;
  "available-balance"?: string | null;
  /** Unix seconds. */
  "balance-date": number;
  transactions?: SfinTransaction[] | null;
};

export type SfinPayload = {
  errors?: string[] | null;
  accounts: SfinAccount[];
};

/** Unix seconds; `end` exclusive. */
export type Window = { start: number; end: number };

export type SyncResult = {
  sfinId: string;
  name: string;
  added: number;
  updated: number;
  matched: number;
  pending: number;
  removed: number;
  balanceRecorded: boolean;
};

export type SyncOutcome =
  | { ok: true; results: SyncResult[]; warnings: string[]; requests: number }
  | { ok: false; error: string };

export type LinkedAccount = {
  id: number;
  sfinId: string;
  orgName: string | null;
  name: string;
  currency: string;
  balanceCents: number | null;
  balanceDate: string | null;
  accountId: number | null;
  enabled: boolean;
  lastSyncedAt: string | null;
};

export type Connection = {
  connected: boolean;
  connectedAt: string | null;
  lastSyncAt: string | null;
  /** Every attempt, successful or not; what the automatic gate counts from. */
  lastAttemptAt: string | null;
  /** The last failure worth telling the user about; cleared by a good sync. */
  lastError: string | null;
  auto: boolean;
  /** `https://…@host/path`; never the credentials. */
  maskedUrl: string | null;
  requestsToday: number;
  accounts: LinkedAccount[];
  earliestSynced: string | null;
  /** Decided on the server: whether opening Home should sync in the background. */
  shouldAutoSync: boolean;
};
