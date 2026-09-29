"use client";
import {
  CalendarCheck,
  CalendarClock,
  CircleDollarSign,
  CreditCard,
  House,
  Landmark,
  LineChart,
  ListChecks,
  Lock,
  PieChart,
  Receipt,
  Settings,
  Target,
  TrendingUp,
  Upload,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Gate } from "@/lib/budget/types";
import { cn } from "@/lib/utils";

const items = [
  { href: "/home", label: "Home", icon: House },
  { href: "/weekly", label: "Weekly review", icon: CalendarCheck },
  { href: "/review", label: "Review", icon: ListChecks },
  { href: "/insights", label: "Insights", icon: PieChart },
  { href: "/bills", label: "Bills", icon: CalendarClock },
  { href: "/budget", label: "Budget", icon: Wallet, gated: true },
  { href: "/goals", label: "Goals", icon: Target, gated: true },
  { href: "/networth", label: "Net worth", icon: TrendingUp },
  { href: "/debt", label: "Debt", icon: CreditCard },
  { href: "/forecast", label: "Forecast", icon: LineChart },
  { href: "/transactions", label: "Transactions", icon: Receipt },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  reviewCount,
  gate,
  reviewDue,
}: {
  reviewCount: number;
  gate: Gate;
  reviewDue: boolean;
}) {
  const path = usePathname();
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col gap-1 border-r border-line bg-canvas px-3 py-6">
      <div className="mb-6 flex items-center gap-2 px-3 text-headline font-semibold">
        <CircleDollarSign className="size-6 text-accent" />
        Finance
      </div>
      {items.map(({ href, label, icon: Icon, gated }) => {
        const active = path.startsWith(href);
        if (gated && !gate.open) {
          return (
            <div
              key={href}
              aria-disabled="true"
              className="px-3 py-2 opacity-50"
            >
              <div className="flex items-center gap-3 text-body font-medium text-ink-2">
                <Icon className="size-5" />
                {label}
                <Lock className="ml-auto size-4" />
              </div>
              <div className="mt-0.5 text-micro text-ink-3">
                Unlocks after {gate.needed} full months ({gate.completeMonths}/
                {gate.needed})
              </div>
            </div>
          );
        }
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-control px-3 py-2 text-body font-medium text-ink-2 transition-colors hover:bg-subtle",
              active && "bg-card text-ink shadow-card",
            )}
          >
            <Icon className="size-5" />
            {label}
            {href === "/review" && reviewCount > 0 && (
              <span className="tnum ml-auto rounded-pill bg-warning px-2 py-0.5 text-micro font-semibold text-white">
                {reviewCount > 99 ? "99+" : reviewCount}
              </span>
            )}
            {href === "/weekly" && reviewDue && (
              <span
                role="img"
                aria-label="Review due"
                className="ml-auto size-2 rounded-pill bg-accent"
              />
            )}
          </Link>
        );
      })}
    </aside>
  );
}
