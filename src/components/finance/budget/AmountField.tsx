"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { formatCents, parseAmountToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

export function AmountField({
  cents,
  onCommit,
  className,
  ariaLabel,
}: {
  cents: number;
  onCommit: (cents: number) => void | Promise<void>;
  className?: string;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const doneRef = useRef(false);

  function startEdit() {
    doneRef.current = false;
    setText((cents / 100).toFixed(2));
    setEditing(true);
  }

  function commit() {
    if (doneRef.current) return;
    doneRef.current = true;
    setEditing(false);
    const parsed = parseAmountToCents(text);
    if (parsed === null) {
      toast.error("Enter a valid amount");
      return;
    }
    const next = Math.max(0, parsed);
    if (next !== cents) onCommit(next);
  }

  function cancel() {
    doneRef.current = true;
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEdit}
        onFocus={startEdit}
        aria-label={ariaLabel}
        className={cn(
          "tnum w-full rounded-control px-1.5 py-1 text-right hover:bg-subtle",
          className,
        )}
      >
        {formatCents(cents, { sign: "never" })}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      inputMode="decimal"
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      className={cn("tnum text-right", className)}
    />
  );
}
