import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories } from "../db/schema";
import { getSetting, setSetting } from "../settings";
import {
  CATEGORIES_SEED_VERSION,
  CATEGORIES_SEED_VERSION_KEY,
  DEFAULT_CATEGORIES,
} from "./defaults";

/**
 * Setting key: seed keys of default categories the user has deleted. The
 * sweep in `ensureDefaultCategories` would otherwise put them straight back
 * the next time DEFAULT_CATEGORIES changes.
 */
export const DELETED_SEED_KEYS = "deleted_seed_keys";

export function deletedSeedKeys(db: Db): Set<string> {
  const raw = getSetting<unknown>(db, DELETED_SEED_KEYS, []);
  return new Set(
    Array.isArray(raw)
      ? raw.filter((k): k is string => typeof k === "string")
      : [],
  );
}

/** Record a deleted default category so no later seed sweep re-creates it. */
export function tombstoneSeedKey(db: Db, seedKey: string): void {
  const keys = deletedSeedKeys(db);
  if (keys.has(seedKey)) return;
  keys.add(seedKey);
  setSetting(db, DELETED_SEED_KEYS, [...keys]);
}

function seedAll(db: Db, deleted: Set<string>): void {
  let sort = 0;
  for (const parent of DEFAULT_CATEGORIES) {
    if (deleted.has(parent.seedKey)) continue;
    const [{ id: parentId }] = db
      .insert(categories)
      .values({
        name: parent.name,
        seedKey: parent.seedKey,
        kind: parent.kind,
        color: parent.color,
        icon: parent.icon,
        isFixed: parent.isFixed,
        sort: sort++,
      })
      .returning({ id: categories.id })
      .all();
    for (const leaf of parent.leaves) {
      if (deleted.has(leaf.seedKey)) continue;
      db.insert(categories)
        .values({
          parentId,
          name: leaf.name,
          seedKey: leaf.seedKey,
          kind: parent.kind,
          color: parent.color,
          icon: parent.icon,
          isFixed: leaf.isFixed ?? parent.isFixed,
          sort: sort++,
        })
        .run();
    }
  }
}

function findBySeedKey(db: Db, seedKey: string): number | undefined {
  return db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.seedKey, seedKey))
    .get()?.id;
}

/**
 * Databases seeded before `seed_key` existed have no keys at all. Match those
 * parents by name once and write the key, so the leaf sweep below can rely on
 * keys from then on.
 */
function backfillParentSeedKeys(db: Db): void {
  for (const parent of DEFAULT_CATEGORIES) {
    if (findBySeedKey(db, parent.seedKey) !== undefined) continue;
    const row = db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.name, parent.name), isNull(categories.parentId)))
      .get();
    if (!row) continue;
    db.update(categories)
      .set({ seedKey: parent.seedKey })
      .where(eq(categories.id, row.id))
      .run();
  }
}

/**
 * Idempotent: returns the id of the leaf, creating it under the named parent
 * if missing.
 *
 * When a `seedKey` is given it is the identity that counts: a default leaf the
 * user has since renamed is found by its key and left alone, instead of being
 * re-created under its original name. Only when no row carries the key does
 * this fall back to matching on (parent, name) — and then it writes the key on
 * to the row it found, which is how a database seeded before keys existed
 * catches up. A key the user has deleted (see `DELETED_SEED_KEYS`) is never
 * re-created: the result is `undefined`.
 */
export function ensureLeaf(
  db: Db,
  parentName: string,
  leafName: string,
  opts: { isFixed?: boolean; seedKey?: string } = {},
): number | undefined {
  if (opts.seedKey !== undefined) {
    const keyed = findBySeedKey(db, opts.seedKey);
    if (keyed !== undefined) return keyed;
    if (deletedSeedKeys(db).has(opts.seedKey)) return undefined;
  }
  const parent = db
    .select()
    .from(categories)
    .where(and(eq(categories.name, parentName), isNull(categories.parentId)))
    .get();
  if (!parent) throw new Error(`Parent category missing: ${parentName}`);
  const existing = db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(eq(categories.name, leafName), eq(categories.parentId, parent.id)),
    )
    .get();
  if (existing) {
    if (opts.seedKey !== undefined)
      db.update(categories)
        .set({ seedKey: opts.seedKey })
        .where(eq(categories.id, existing.id))
        .run();
    return existing.id;
  }
  const maxSort = db
    .select({ s: categories.sort })
    .from(categories)
    .all()
    .reduce((m, r) => Math.max(m, r.s), 0);
  const [row] = db
    .insert(categories)
    .values({
      parentId: parent.id,
      name: leafName,
      seedKey: opts.seedKey ?? null,
      kind: parent.kind,
      color: parent.color,
      icon: parent.icon,
      isFixed: opts.isFixed ?? parent.isFixed,
      sort: maxSort + 1,
    })
    .returning({ id: categories.id })
    .all();
  return row.id;
}

export function ensureDefaultCategories(db: Db): void {
  if (db.select().from(categories).limit(1).all().length === 0) {
    seedAll(db, deletedSeedKeys(db));
    setSetting(db, CATEGORIES_SEED_VERSION_KEY, CATEGORIES_SEED_VERSION);
    return;
  }
  // The sweep below runs on hot paths; skip it once the database is known to
  // be up to date with the current DEFAULT_CATEGORIES.
  if (
    getSetting<number>(db, CATEGORIES_SEED_VERSION_KEY, 0) ===
    CATEGORIES_SEED_VERSION
  )
    return;
  backfillParentSeedKeys(db);
  const deleted = deletedSeedKeys(db);
  // Leaves added after a database was first seeded. A group the user deleted
  // takes its leaves with it; a deleted leaf is skipped inside ensureLeaf.
  for (const parent of DEFAULT_CATEGORIES) {
    if (deleted.has(parent.seedKey)) continue;
    for (const leaf of parent.leaves)
      ensureLeaf(db, parent.name, leaf.name, {
        isFixed: leaf.isFixed ?? parent.isFixed,
        seedKey: leaf.seedKey,
      });
  }
  setSetting(db, CATEGORIES_SEED_VERSION_KEY, CATEGORIES_SEED_VERSION);
}

export function findCategoryId(db: Db, name: string): number | undefined {
  return db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name))
    .get()?.id;
}

/**
 * Find a category by its stable seed key rather than its (possibly renamed)
 * display name. Builtin rules should resolve categories this way so renaming
 * a default leaf doesn't orphan the rules that point at it.
 */
export function findCategoryIdBySeedKey(
  db: Db,
  seedKey: string,
): number | undefined {
  return db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.seedKey, seedKey))
    .get()?.id;
}
