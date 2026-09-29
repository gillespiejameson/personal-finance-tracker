"use client";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function ImportDropzone({
  onFile,
  className,
}: {
  onFile: (file: File) => void;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-line bg-card p-12 text-center transition-all",
        over && "scale-[1.01] border-accent bg-subtle",
        className,
      )}
    >
      <span className="flex size-14 items-center justify-center rounded-pill bg-subtle">
        <Upload className="size-6 text-accent" />
      </span>
      <span className="text-headline font-semibold">
        Drop a bank statement here
      </span>
      <span className="text-caption text-ink-2">or click to choose a file</span>
      <span className="mt-2 flex gap-2">
        {["CSV", "OFX", "QFX"].map((t) => (
          <span
            key={t}
            className="rounded-pill bg-subtle px-2.5 py-1 text-micro font-semibold text-ink-2"
          >
            {t}
          </span>
        ))}
      </span>
      <input
        ref={input}
        type="file"
        accept=".csv,.ofx,.qfx,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </button>
  );
}
