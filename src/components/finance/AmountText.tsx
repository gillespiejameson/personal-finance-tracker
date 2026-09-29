import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

type Props = {
  cents: number;
  sign?: "auto" | "always" | "never";
  className?: string;
  colorize?: boolean;
  size?: "micro" | "caption" | "body" | "headline" | "display";
};

const SIZE = {
  micro: "text-micro",
  caption: "text-caption",
  body: "text-body",
  headline: "text-headline",
  display: "text-display",
} as const;

export function AmountText({
  cents,
  sign = "auto",
  className,
  colorize = true,
  size,
}: Props) {
  // Size lives outside `cn`: tailwind-merge cannot tell a text size from a text
  // colour, so a `text-ink` in `className` would otherwise drop `text-display`.
  const merged = cn(
    "tnum",
    colorize && cents > 0 && "text-positive",
    colorize && cents < 0 && "text-ink",
    className,
  );
  return (
    <span className={size ? `${merged} ${SIZE[size]}` : merged}>
      {formatCents(cents, { sign })}
    </span>
  );
}
