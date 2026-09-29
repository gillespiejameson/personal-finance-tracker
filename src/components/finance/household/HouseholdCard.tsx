"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  generateWallTokenAction,
  revokeWallTokenAction,
} from "@/actions/household";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function HouseholdCard({
  tokenSet,
  createdAtLabel,
  origin,
}: {
  tokenSet: boolean;
  createdAtLabel: string | null;
  origin: string;
}) {
  const [fresh, setFresh] = useState<{
    token: string;
    enrollUrl: string;
  } | null>(null);
  const [pending, start] = useTransition();
  const generate = (rotate: boolean) => {
    if (
      rotate &&
      !window.confirm(
        "Rotate the display token? Every enrolled display and the hub stop working until re-enrolled.",
      )
    )
      return;
    start(async () => {
      const r = await generateWallTokenAction();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setFresh({ token: r.token, enrollUrl: r.enrollUrl });
      toast.success(rotate ? "Token rotated" : "Token generated");
    });
  };
  const revoke = () => {
    if (
      !window.confirm(
        "Revoke the display token? Every enrolled display and the hub stop working.",
      )
    )
      return;
    start(async () => {
      await revokeWallTokenAction();
      setFresh(null);
      toast.success("Token revoked");
    });
  };
  /** No `navigator.clipboard` on an insecure origin (http://<lan-host>:3000). */
  const copy = (text: string, what: string) => {
    if (!navigator.clipboard) {
      toast.error("Copy failed — select the text and copy it");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${what} copied`),
      () => toast.error("Copy failed"),
    );
  };
  return (
    <Card>
      <h2 className="mb-1 text-headline font-semibold">Household</h2>
      <p className="mb-4 text-caption text-ink-2">
        Access from outside the house is handled by Cloudflare Access; see
        docs/HOUSEHOLD.md in the project for the setup. A wall display or your
        own dashboard reads this app through a display token.
      </p>
      {fresh ? (
        <div className="grid gap-3">
          <p className="text-caption text-negative">
            Shown once. Copy it now; it will not be shown again.
          </p>
          <div className="grid gap-1">
            <label className="text-caption text-ink-2" htmlFor="wall-token">
              Display token
            </label>
            <div className="flex gap-2">
              <Input
                id="wall-token"
                readOnly
                value={fresh.token}
                className="tnum"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => copy(fresh.token, "Token")}
              >
                Copy
              </Button>
            </div>
          </div>
          <div className="grid gap-1">
            <label className="text-caption text-ink-2" htmlFor="wall-enroll">
              Enrollment link for the display (open it once in the display's
              browser)
            </label>
            <div className="flex gap-2">
              <Input id="wall-enroll" readOnly value={fresh.enrollUrl} />
              <Button
                type="button"
                variant="outline"
                onClick={() => copy(fresh.enrollUrl, "Link")}
              >
                Copy
              </Button>
            </div>
          </div>
          <p className="text-caption text-ink-2">
            Links use this address: {origin}. From outside the house use your
            Cloudflare hostname instead.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-body">
            {tokenSet
              ? `Display token set${createdAtLabel ? ` ${createdAtLabel}` : ""}`
              : "No display token"}
          </span>
          {tokenSet ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => generate(true)}
              >
                Rotate
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={revoke}
              >
                Revoke
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => generate(false)}
            >
              Generate token
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
