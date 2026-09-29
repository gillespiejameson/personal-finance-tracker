import fs from "node:fs";
import path from "node:path";
import { backupDb } from "@/lib/db/backup";
import { dbPath } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const dest = backupDb(dbPath());
    const body = fs.readFileSync(dest);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${path.basename(dest)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Backup failed: ${message}`, { status: 500 });
  }
}
