import { listAccounts } from "@/actions/accounts";
import { AccountCard } from "@/components/finance/AccountCard";
import { AccountForm } from "@/components/finance/AccountForm";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const rows = await listAccounts();
  return (
    <>
      <h1 className="mb-6 text-title font-semibold">Accounts</h1>
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-7 grid gap-4">
          {rows.length === 0 && (
            <Card className="text-ink-2">
              No accounts yet. Add your first one on the right.
            </Card>
          )}
          {rows.map((a) => (
            <AccountCard key={a.id} account={a} />
          ))}
        </div>
        <Card className="col-span-5 self-start">
          <h2 className="mb-4 text-headline font-semibold">Add account</h2>
          <AccountForm />
        </Card>
      </div>
    </>
  );
}
