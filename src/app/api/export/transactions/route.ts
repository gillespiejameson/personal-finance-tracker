import { isIsoDate } from "@/lib/dates";
import { getDb } from "@/lib/db/client";
import { exportFilename, transactionsCsv } from "@/lib/export/transactions";
import { parseIdParam } from "@/lib/sqlLike";
import type { TxnFilter } from "@/lib/transactions/summary";

export const dynamic = "force-dynamic";

/**
 * Mirrors how `src/app/(app)/transactions/page.tsx` reads its search
 * params, except an out-of-range `from`/`to` is a 400 here rather than
 * silently dropped — the caller building this URL is code, not a person
 * clicking through the filter UI.
 */
export async function GET(request: Request): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const from = sp.get("from") ?? undefined;
  const to = sp.get("to") ?? undefined;
  if (from !== undefined && !isIsoDate(from)) {
    return new Response(`Invalid from date: ${from}`, { status: 400 });
  }
  if (to !== undefined && !isIsoDate(to)) {
    return new Response(`Invalid to date: ${to}`, { status: 400 });
  }
  // The page passes `q` through unbounded — truncate rather than 400 so a
  // long search term still exports (matching what the on-screen list did).
  const q = sp.get("q")?.slice(0, 80) ?? undefined;
  const filter: TxnFilter = {
    accountId: parseIdParam(sp.get("account") ?? undefined),
    categoryId: parseIdParam(sp.get("category") ?? undefined),
    parentId: parseIdParam(sp.get("group") ?? undefined),
    from,
    to,
    q,
  };

  try {
    const body = transactionsCsv(getDb(), filter);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(filter)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Export failed: ${message}`, {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
