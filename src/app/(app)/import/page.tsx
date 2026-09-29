import Link from "next/link";
import { listAccounts } from "@/actions/accounts";
import { ImportFlow } from "@/components/finance/ImportFlow";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const accounts = await listAccounts();
  return (
    <>
      <h1 className="mb-6 text-title font-semibold">Import</h1>
      {accounts.length === 0 ? (
        <Card>
          Add an{" "}
          <Link className="text-accent" href="/accounts">
            account
          </Link>{" "}
          first, then come back to import.
        </Card>
      ) : (
        <ImportFlow
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            color: a.color,
          }))}
        />
      )}
    </>
  );
}
