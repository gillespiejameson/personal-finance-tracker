import type { LucideIcon } from "lucide-react";
import { tint } from "@/lib/categories/palette";
import { cn } from "@/lib/utils";

type Props = {
  name: string;
  color: string;
  icon?: LucideIcon;
  dashed?: boolean;
  className?: string;
};

export function CategoryChip({
  name,
  color,
  icon: Icon,
  dashed,
  className,
}: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-caption font-medium",
        dashed && "border border-dashed",
        className,
      )}
      style={{
        backgroundColor: dashed ? "transparent" : tint(color, 0.12),
        color,
        borderColor: color,
      }}
    >
      {Icon && <Icon className="size-3.5" />}
      {name}
    </span>
  );
}
