import fs from "node:fs";
import { dbPath, openDb } from "../src/lib/db/client";
import { seed } from "../src/lib/seed";

const file = dbPath();
console.log(`Warning: this wipes the dev database (${file}) and reseeds it.`);

for (const f of [file, `${file}-wal`, `${file}-shm`])
  if (fs.existsSync(f)) fs.unlinkSync(f);
const db = openDb(file);
const r = seed(db, { months: 3 });
console.log(
  `Seeded ${r.accounts} accounts, ${r.transactions} transactions → ${file}`,
);
