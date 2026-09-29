import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export function backupDb(
  file: string,
  backupsDir = path.join(path.dirname(file), "backups"),
  keep = 20,
): string {
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "-");
  const dest = path.join(backupsDir, `finance-${stamp}.db`);
  const src = new Database(file, { readonly: false });
  try {
    src.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    src.close();
  }
  fs.copyFileSync(file, dest);
  const all = fs
    .readdirSync(backupsDir)
    .filter((f) => /^finance-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse();
  for (const old of all.slice(keep)) fs.unlinkSync(path.join(backupsDir, old));
  return dest;
}
