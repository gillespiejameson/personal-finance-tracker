"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  commitFile,
  type ProfileOverride,
  previewFile,
  undoImportAction,
} from "@/actions/imports";
import { ImportDropzone } from "@/components/finance/ImportDropzone";
import { ImportPreview } from "@/components/finance/ImportPreview";
import { MappingWizard } from "@/components/finance/MappingWizard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PreviewResult } from "@/lib/import/preview";

type Account = { id: number; name: string; type: string; color: string };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

export function ImportFlow({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [override, setOverride] = useState<ProfileOverride | undefined>();
  const [wizardName, setWizardName] = useState<string | undefined>();
  const [wizard, setWizard] = useState(false);
  const [accountId, setAccountId] = useState<number | null>(
    accounts[0]?.id ?? null,
  );
  const [committing, setCommitting] = useState(false);

  function reset() {
    setFile(null);
    setPreview(null);
    setOverride(undefined);
    setWizardName(undefined);
    setWizard(false);
  }

  async function load(name: string, text: string, o?: ProfileOverride) {
    try {
      const p = await previewFile(name, text, o);
      setPreview(p);
      setOverride(o);
      setWizard(p.kind === "csv" && !p.profile);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function onFile(f: File) {
    if (f.size > 5 * 1024 * 1024) {
      toast.error("That file is over 5 MB. Export a shorter date range.");
      return;
    }
    if (/\.pdf$/i.test(f.name)) {
      toast.error(
        "PDF statements aren't supported yet. In your bank's website, export the account activity as CSV or QFX and drop that here.",
      );
      return;
    }
    const text = await f.text();
    setFile({ name: f.name, text });
    setWizardName(undefined);
    await load(f.name, text);
  }

  function currentOverride(): ProfileOverride {
    const p = preview?.profile;
    return (
      override ??
      (p
        ? {
            dateCol: p.dateCol,
            descCol: p.descCol,
            amountCol: p.amountCol,
            debitCol: p.debitCol,
            creditCol: p.creditCol,
            balanceCol: p.balanceCol,
            dateFormat: p.dateFormat,
            signConvention: p.signConvention,
            skipRows: p.skipRows,
          }
        : {})
    );
  }

  async function commit() {
    if (!file || !accountId) return;
    setCommitting(true);
    try {
      const res = await commitFile({
        accountId,
        filename: file.name,
        text: file.text,
        override,
        saveProfileAs: wizardName,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `${res.newCount} new · ${res.dupCount} duplicates skipped${res.categorized ? ` · ${res.categorized} categorized` : ""}${res.flaggedCount ? ` · ${res.flaggedCount} flagged` : ""}`,
        {
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                const u = await undoImportAction(res.importId);
                toast(`Removed ${u.removed} transactions`);
                router.refresh();
              } catch (e) {
                toast.error(errorMessage(e));
              }
            },
          },
          duration: 10000,
        },
      );
      router.push("/transactions");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCommitting(false);
    }
  }

  if (!file || !preview) return <ImportDropzone onFile={onFile} />;
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-caption text-ink-2">{file.name}</div>
        <Button variant="ghost" size="sm" onClick={reset} disabled={committing}>
          Choose a different file
        </Button>
      </div>
      {wizard ? (
        <MappingWizard
          // Re-seed the wizard's local state when a new "rows to skip" value
          // changes which line is the header row.
          key={preview.headers.join("\u0000")}
          headers={preview.headers}
          sample={preview.sampleRaw}
          initial={(() => {
            const wizardInitial: ProfileOverride | undefined = preview.profile
              ? {
                  ...currentOverride(),
                  name: override?.name ?? preview.profile.name,
                }
              : override;
            return wizardInitial;
          })()}
          onApply={(o) => {
            setWizardName(o.name);
            load(file.name, file.text, o);
          }}
        />
      ) : (
        <ImportPreview
          preview={preview}
          accounts={accounts}
          accountId={accountId}
          onAccount={setAccountId}
          committing={committing}
          onCommit={commit}
          onRemap={() => setWizard(true)}
          onFlipSign={() => {
            const o = currentOverride();
            const sc =
              o.signConvention === "outflow_positive"
                ? "outflow_negative"
                : "outflow_positive";
            load(file.name, file.text, { ...o, signConvention: sc });
          }}
          onDateFormat={(f) =>
            load(file.name, file.text, { ...currentOverride(), dateFormat: f })
          }
        />
      )}
    </Card>
  );
}
