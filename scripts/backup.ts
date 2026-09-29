import { backupDb } from "../src/lib/db/backup";
import { dbPath } from "../src/lib/db/client";

console.log(backupDb(dbPath()));
