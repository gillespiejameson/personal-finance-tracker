"use client";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  type AccountInput,
  createAccount,
  updateAccount,
} from "@/actions/accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACCOUNT_COLORS } from "@/lib/categories/palette";

const TYPES = [
  "checking",
  "savings",
  "credit",
  "cash",
  "loan",
  "investment",
] as const;
const COLORS = ACCOUNT_COLORS; // defined in src/lib/categories/palette.ts (Task 3); components hold no hex literals

const EMPTY: AccountInput = {
  name: "",
  type: "checking",
  institution: "",
  color: COLORS[0],
};

export function AccountForm({
  initial,
  id,
  onDone,
  onCancel,
}: {
  initial?: AccountInput;
  id?: number;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<AccountInput>(initial ?? EMPTY);
  const [pending, start] = useTransition();
  // An edit form and the "Add account" form render side by side on /accounts,
  // so the field ids have to be unique per instance.
  const uid = useId();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = id
            ? await updateAccount(id, form)
            : await createAccount(form);
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success(id ? "Account updated" : "Account added");
          if (!id) setForm(EMPTY);
          onDone?.();
        });
      }}
    >
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor={`${uid}-name`}
      >
        Name
        <Input
          id={`${uid}-name`}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Chase Checking"
          maxLength={60}
          required
        />
      </label>
      <label className="grid gap-1 text-caption text-ink-2">
        Type
        <select
          className="h-9 rounded-control border border-line bg-card px-3 text-body"
          value={form.type}
          onChange={(e) =>
            setForm({ ...form, type: e.target.value as AccountInput["type"] })
          }
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label
        className="grid gap-1 text-caption text-ink-2"
        htmlFor={`${uid}-institution`}
      >
        Institution
        <Input
          id={`${uid}-institution`}
          value={form.institution ?? ""}
          onChange={(e) => setForm({ ...form, institution: e.target.value })}
          placeholder="Chase"
          maxLength={60}
        />
      </label>
      <div className="flex gap-2">
        {COLORS.map((c, i) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${i + 1}`}
            aria-pressed={form.color === c}
            onClick={() => setForm({ ...form, color: c })}
            className="size-7 rounded-pill ring-offset-2 transition-transform hover:scale-110"
            style={{
              backgroundColor: c,
              boxShadow:
                form.color === c
                  ? `0 0 0 2px var(--color-card), 0 0 0 4px ${c}`
                  : undefined,
            }}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {id ? "Save" : "Add account"}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
