"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  connectAction,
  disconnectAction,
  loadOlderAction,
  mapAccountAction,
  setAutoAction,
  setEnabledAction,
  syncNowAction,
} from "@/actions/simplefin";
import { AmountText } from "@/components/finance/AmountText";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { shortDay } from "@/lib/simplefin/stale";
import { summarize } from "@/lib/simplefin/summary";
import type { Connection, SyncOutcome } from "@/lib/simplefin/types";

const TOKEN_URL = "https://bridge.simplefin.org/simplefin/create";

/** An armed Disconnect forgets it was asked, so a stray later click is safe. */
const DISARM_MS = 10_000;

export type AppAccountOption = { id: number; name: string };

type Props = {
  connection: Connection;
  appAccounts: AppAccountOption[];
  /** Worded on the server so the client never derives times from its own clock. */
  connectedLabel: string | null;
  lastSyncLabel: string | null;
};

function NotConnected({
  busy,
  onConnect,
}: {
  busy: boolean;
  onConnect: (token: string) => void;
}) {
  const inputId = useId();
  const [token, setToken] = useState("");
  return (
    <>
      <p className="mb-4 text-caption text-ink-2">
        SimpleFIN reads transactions and balances from your banks; the app never
        sees your bank passwords. Create a setup token, paste it below, then map
        each connected account. CSV import keeps working.
      </p>
      <a
        href={TOKEN_URL}
        target="_blank"
        rel="noreferrer"
        className="text-caption text-accent"
      >
        Get a setup token
      </a>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label
          className="grid flex-1 gap-1 text-caption text-ink-2"
          htmlFor={inputId}
        >
          Setup token
          <Input
            id={inputId}
            value={token}
            placeholder="base64 setup token"
            onChange={(e) => setToken(e.target.value)}
            className="min-w-64"
          />
        </label>
        <Button
          disabled={busy || token.trim() === ""}
          onClick={() => onConnect(token)}
        >
          {busy ? "Connecting…" : "Connect"}
        </Button>
      </div>
    </>
  );
}

export function ConnectionsCard({
  connection,
  appAccounts,
  connectedLabel,
  lastSyncLabel,
}: Props) {
  const router = useRouter();
  const [busy, start] = useTransition();
  // This visit's own sync outcome wins (it can carry "Load older history"
  // wording that is never kept); until then show what the last sync kept.
  const [ownWarnings, setWarnings] = useState<string[] | null>(null);
  const warnings = ownWarnings ?? connection.warnings;
  const staleByOrg = new Map(connection.staleBanks.map((b) => [b.orgName, b]));
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const autoId = useId();
  const rowId = useId();

  useEffect(() => {
    if (!confirmDisconnect) return;
    const t = setTimeout(() => setConfirmDisconnect(false), DISARM_MS);
    return () => clearTimeout(t);
  }, [confirmDisconnect]);

  function report(outcome: SyncOutcome) {
    // A window can commit before a later one fails, so refresh either way.
    if (outcome.ok) {
      toast.success(summarize(outcome.results));
      setWarnings(outcome.warnings);
    } else {
      toast.error(outcome.error);
    }
    router.refresh();
  }

  function connect(token: string) {
    start(async () => {
      const r = await connectAction({ token });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Connected to SimpleFIN");
      report(r.sync);
    });
  }

  function sync() {
    start(async () => {
      report(await syncNowAction({ automatic: false }));
    });
  }

  function older() {
    start(async () => {
      report(await loadOlderAction());
    });
  }

  function remap(sfinId: string, value: string) {
    start(async () => {
      const r = await mapAccountAction({
        sfinId,
        accountId:
          value === "" ? null : value === "create" ? "create" : Number(value),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Account mapping saved");
      router.refresh();
    });
  }

  function toggleEnabled(sfinId: string, enabled: boolean) {
    start(async () => {
      const r = await setEnabledAction({ sfinId, enabled });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      router.refresh();
    });
  }

  function toggleAuto(auto: boolean) {
    start(async () => {
      const r = await setAutoAction({ auto });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(auto ? "Automatic sync on" : "Automatic sync off");
      router.refresh();
    });
  }

  function disconnect() {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      return;
    }
    start(async () => {
      await disconnectAction();
      setConfirmDisconnect(false);
      setWarnings([]);
      toast.success("Disconnected. Your transactions stay.");
      router.refresh();
    });
  }

  return (
    <Card>
      <h2 className="mb-1 text-headline font-semibold">Connections</h2>
      {!connection.connected ? (
        <NotConnected busy={busy} onConnect={connect} />
      ) : (
        <>
          <p className="text-caption text-ink-2">
            Connected{connectedLabel ? ` since ${connectedLabel}` : ""} · last
            sync {lastSyncLabel ?? "never"} · {connection.requestsToday} request
            {connection.requestsToday === 1 ? "" : "s"} today
          </p>
          {connection.maskedUrl && (
            <p className="mt-0.5 text-micro text-ink-3">
              {connection.maskedUrl}
            </p>
          )}
          {connection.lastError && (
            <p className="mt-2 text-caption text-warning">
              Last sync failed: {connection.lastError}
            </p>
          )}
          {connection.staleBanks.map((b) => (
            <p key={b.orgName} className="mt-2 text-caption text-warning">
              {b.orgName} hasn't sent SimpleFIN new data since{" "}
              {shortDay(b.lastUpdated)}. Sign in at bridge.simplefin.org and
              reconnect it, then Sync now.
            </p>
          ))}

          <div className="mt-4 grid gap-2">
            {connection.accounts.length === 0 && (
              <p className="text-caption text-ink-2">
                {connection.lastError
                  ? "SimpleFIN didn't answer, so no accounts are listed yet. Fix the error above, then Sync now."
                  : "No accounts yet — sync once to list what SimpleFIN shares."}
              </p>
            )}
            {connection.accounts.map((a) => {
              const usable = a.currency === "USD";
              return (
                <div
                  key={a.sfinId}
                  className="flex flex-wrap items-center gap-3 rounded-control border border-line px-4 py-3"
                >
                  <span className="min-w-40 flex-1">
                    <span className="block truncate text-body font-medium">
                      {a.name}
                    </span>
                    <span className="block truncate text-micro text-ink-3">
                      {a.orgName ?? "SimpleFIN"}
                      {usable ? "" : ` · ${a.currency} — not syncable`}
                      {a.enabled &&
                        a.accountId !== null &&
                        a.balanceDate &&
                        staleByOrg.has(a.orgName ?? "SimpleFIN") && (
                          <span className="text-warning">
                            {` · no new data since ${shortDay(a.balanceDate)}`}
                          </span>
                        )}
                    </span>
                  </span>
                  {a.balanceCents !== null && (
                    <span className="shrink-0 text-right">
                      <AmountText
                        cents={a.balanceCents}
                        sign="auto"
                        colorize={false}
                        size="caption"
                        className="block text-ink-2"
                      />
                      {a.balanceCents < 0 && (
                        <span className="block text-micro text-ink-3">
                          owed
                        </span>
                      )}
                    </span>
                  )}
                  <label
                    className="text-caption text-ink-2"
                    htmlFor={`${rowId}-map-${a.id}`}
                  >
                    <span className="sr-only">Mapped account</span>
                    <select
                      id={`${rowId}-map-${a.id}`}
                      disabled={busy || !usable}
                      value={a.accountId === null ? "" : String(a.accountId)}
                      onChange={(e) => remap(a.sfinId, e.target.value)}
                      className="h-8 rounded-control border border-line bg-transparent px-2.5 text-body"
                    >
                      <option value="">Not mapped</option>
                      {appAccounts.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                      <option value="create">Create account…</option>
                    </select>
                  </label>
                  <label
                    className="flex items-center gap-1.5 text-caption text-ink-2"
                    htmlFor={`${rowId}-on-${a.id}`}
                  >
                    <input
                      id={`${rowId}-on-${a.id}`}
                      type="checkbox"
                      disabled={busy || !usable}
                      checked={a.enabled}
                      onChange={(e) =>
                        toggleEnabled(a.sfinId, e.target.checked)
                      }
                    />
                    Enabled
                  </label>
                </div>
              );
            })}
          </div>

          {warnings.length > 0 && (
            <ul className="mt-4 grid gap-1 rounded-control bg-subtle p-3 text-caption text-warning">
              {warnings.map((w, i) => (
                // Two accounts can report the same wording, so position counts
                // too; the list is replaced whole on every sync.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                <li key={`${i}:${w}`}>{w}</li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={sync}>
              {busy ? "Syncing…" : "Sync now"}
            </Button>
            <Button variant="outline" disabled={busy} onClick={older}>
              Load older history
            </Button>
            <label
              className="ml-1 flex items-center gap-1.5 text-caption text-ink-2"
              htmlFor={autoId}
            >
              <input
                id={autoId}
                type="checkbox"
                disabled={busy}
                checked={connection.auto}
                onChange={(e) => toggleAuto(e.target.checked)}
              />
              Sync automatically
            </label>
            <Button
              variant="outline"
              disabled={busy}
              className="ml-auto"
              onClick={disconnect}
            >
              {confirmDisconnect ? "Disconnect — confirm" : "Disconnect"}
            </Button>
          </div>
          {confirmDisconnect && (
            <p className="mt-2 text-caption text-warning">
              This forgets the access URL. Your transactions and balances stay.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
