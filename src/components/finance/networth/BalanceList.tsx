"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setBalanceAction } from "@/actions/networth";
import { AmountText } from "@/components/finance/AmountText";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCents, parseAmountToCents } from "@/lib/money";
import type { AccountBalance } from "@/lib/networth/types";

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

function AccountRow({
  account,
  today,
}: {
  account: AccountBalance;
  today: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();

  const amountLabel = account.isLiability ? "Amount owed" : "Balance";

  function save() {
    const cents = parseAmountToCents(amount);
    if (cents === null) {
      toast.error("Enter a valid amount");
      return;
    }
    start(async () => {
      const r = await setBalanceAction({
        accountId: account.id,
        date,
        balanceCents: cents,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Balance saved");
      setAmount("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4 last:border-b-0">
      <span
        className="size-3 shrink-0 rounded-pill"
        style={{ backgroundColor: account.color }}
      />
      <div className="min-w-[160px] flex-1">
        <div className="flex items-center gap-2">
          <span className="text-body font-medium">{account.name}</span>
          <span className="rounded-pill bg-subtle px-1.5 text-micro text-ink-3">
            {account.isLiability ? "liability" : "asset"}
          </span>
        </div>
        <div className="mt-0.5 text-caption text-ink-2">
          {account.balanceCents === null || account.asOf === null ? (
            "No balance yet"
          ) : account.isLiability ? (
            <>
              <span className="tnum text-negative">
                −{formatCents(account.balanceCents, { sign: "never" })}
              </span>
              {` as of ${longDate(account.asOf)}`}
            </>
          ) : (
            <>
              <AmountText
                cents={account.balanceCents}
                sign="auto"
                colorize={false}
                className="text-ink"
              />
              {` as of ${longDate(account.asOf)}`}
            </>
          )}
        </div>
      </div>
      <div className="flex items-end gap-2">
        <label
          className="grid gap-1 text-caption text-ink-2"
          htmlFor={`nw-date-${account.id}`}
        >
          Date
          <Input
            id={`nw-date-${account.id}`}
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="w-36"
          />
        </label>
        <label
          className="grid gap-1 text-caption text-ink-2"
          htmlFor={`nw-amount-${account.id}`}
        >
          {amountLabel}
          <Input
            id={`nw-amount-${account.id}`}
            inputMode="decimal"
            placeholder="$0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-28"
          />
        </label>
        <Button disabled={pending} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

export function BalanceList({
  accounts,
  today,
}: {
  accounts: AccountBalance[];
  today: string;
}) {
  return (
    <Card className="p-0">
      {accounts.map((a) => (
        <AccountRow key={a.id} account={a} today={today} />
      ))}
    </Card>
  );
}
