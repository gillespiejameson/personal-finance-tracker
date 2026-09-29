"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { setCategoryRollover } from "@/actions/budget";
import {
  addCategoryAction,
  addParentCategoryAction,
  archiveCategoryAction,
  archiveParentCategoryAction,
  deleteCategoryAction,
  deleteParentCategoryAction,
  listCategoryReferencesAction,
  renameCategoryAction,
  renameParentCategoryAction,
  setCategoryFixedAction,
  setParentColorAction,
} from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  CategoryReferences,
  listCategoryTree,
} from "@/lib/categories/manage";
import { GROUP_COLORS, nextGroupColor } from "@/lib/categories/palette";

type Tree = ReturnType<typeof listCategoryTree>;
type Parent = Tree[number];
type Leaf = Parent["leaves"][number];
/** An active leaf elsewhere in the tree that a deleted leaf's references can move to. */
type MoveTarget = { id: number; label: string };

const REFERENCE_LABELS: [keyof CategoryReferences, string, string][] = [
  ["transactions", "transaction", "transactions"],
  ["splits", "split", "splits"],
  ["rules", "rule", "rules"],
  ["budgets", "budget month", "budget months"],
  ["planned", "planned expense", "planned expenses"],
  ["goals", "goal", "goals"],
  ["recurring", "bill", "bills"],
];

/** "12 transactions, 2 rules and 1 budget month" */
function describeReferences(refs: CategoryReferences): string {
  const parts = REFERENCE_LABELS.filter(([k]) => refs[k] > 0).map(
    ([k, one, many]) => `${refs[k]} ${refs[k] === 1 ? one : many}`,
  );
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function totalReferences(refs: CategoryReferences): number {
  return Object.values(refs).reduce((a, b) => a + b, 0);
}

function MoveAndDeleteDialog({
  leaf,
  refs,
  targets,
  onClose,
}: {
  leaf: Leaf;
  refs: CategoryReferences;
  targets: MoveTarget[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [moveTo, setMoveTo] = useState<number | null>(targets[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    // Focus lands in the dialog either way, so Escape works from the start.
    (selectRef.current ?? dialogRef.current)?.focus();
  }, []);

  async function submit() {
    if (moveTo === null || busy) return;
    setBusy(true);
    try {
      const r = await deleteCategoryAction({ id: leaf.id, moveTo });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const target = targets.find((t) => t.id === moveTo)?.label ?? "";
      toast.success(
        `Moved ${describeReferences(refs)} to ${target}; deleted ${leaf.name}`,
      );
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
      aria-labelledby={`delete-${leaf.id}-title`}
      className="my-2 rounded-card border border-line bg-subtle/60 p-4 outline-none"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <p id={`delete-${leaf.id}-title`} className="mb-3 text-body">
        Delete "{leaf.name}"? Move its {describeReferences(refs)} to:
      </p>
      {targets.length === 0 ? (
        <p className="mb-3 text-caption text-ink-2">
          There is no other active category to move them to. Add one first.
        </p>
      ) : (
        <select
          ref={selectRef}
          aria-label="Move to category"
          className="mb-3 h-9 rounded-control border border-line bg-card px-2 text-body"
          value={moveTo ?? ""}
          onChange={(e) => setMoveTo(Number(e.target.value))}
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={moveTo === null || busy}
          onClick={submit}
        >
          {busy ? "Moving…" : "Move and delete"}
        </Button>
      </div>
    </div>
  );
}

function CategoryRow({ leaf, targets }: { leaf: Leaf; targets: MoveTarget[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(leaf.name);
  const [pendingRefs, setPendingRefs] = useState<CategoryReferences | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const saving = useRef(false);
  const deleteRef = useRef<HTMLButtonElement>(null);

  function closeDialog() {
    setPendingRefs(null);
    deleteRef.current?.focus();
  }

  async function remove() {
    if (checking) return;
    setChecking(true);
    try {
      const refs = await listCategoryReferencesAction(leaf.id);
      if (refs === null) {
        toast.error("Couldn't check what uses this category.");
        return;
      }
      if (refs.goals > 0) {
        // A live goal blocks the delete outright; only the server knows
        // whether the goal is archived, so ask it before offering a move.
        const r = await deleteCategoryAction({ id: leaf.id });
        if (!r.ok && r.error === "Archive the goal instead.") {
          toast.error(r.error);
          return;
        }
      }
      if (totalReferences(refs) > 0) {
        setPendingRefs(refs);
        return;
      }
      if (!window.confirm(`Delete "${leaf.name}"? Nothing uses it.`)) return;
      const r = await deleteCategoryAction({ id: leaf.id });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Deleted ${leaf.name}`);
      router.refresh();
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    if (saving.current) return;
    saving.current = true;
    try {
      const r = await renameCategoryAction({ id: leaf.id, name: draft });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      saving.current = false;
    }
  }

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-3">
        {editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(leaf.name);
                setEditing(false);
              }
            }}
            className="h-7 max-w-48"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(leaf.name);
              setEditing(true);
            }}
            className={`text-body ${leaf.archived ? "text-ink-3" : "text-ink"}`}
          >
            {leaf.name}
            {leaf.archived && (
              <span className="ml-1 text-caption text-ink-3">(archived)</span>
            )}
          </button>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-caption text-ink-2">
          <input
            type="checkbox"
            id={`fixed-${leaf.id}`}
            checked={leaf.isFixed}
            onChange={async (e) => {
              const r = await setCategoryFixedAction({
                id: leaf.id,
                isFixed: e.target.checked,
              });
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              router.refresh();
            }}
          />
          Fixed
        </label>
        <label className="flex items-center gap-1.5 text-caption text-ink-2">
          <input
            type="checkbox"
            id={`rollover-${leaf.id}`}
            checked={leaf.rollover}
            onChange={async (e) => {
              const r = await setCategoryRollover({
                id: leaf.id,
                rollover: e.target.checked,
              });
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              router.refresh();
            }}
          />
          Rollover
        </label>
        <span className="tnum w-10 text-right text-caption text-ink-2">
          {leaf.txnCount}
        </span>
        {leaf.refCount === 0 && !leaf.archived && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="Hides this category. Any builtin rules pointing at it are switched off."
            onClick={async () => {
              const r = await archiveCategoryAction(leaf.id);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              router.refresh();
            }}
          >
            Archive
          </Button>
        )}
        <Button
          ref={deleteRef}
          type="button"
          variant="ghost"
          size="sm"
          disabled={checking}
          title="Removes this category for good. Anything using it is moved to a category you pick."
          onClick={remove}
        >
          Delete
        </Button>
      </div>
      {pendingRefs && (
        <MoveAndDeleteDialog
          leaf={leaf}
          refs={pendingRefs}
          targets={targets}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}

function ColorSwatches({
  colors,
  selected,
  onPick,
}: {
  colors: readonly string[];
  selected: string;
  onPick: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Use color ${c}`}
          aria-pressed={c.toLowerCase() === selected.toLowerCase()}
          onClick={() => onPick(c)}
          className={`size-5 rounded-pill ring-offset-1 ${
            c.toLowerCase() === selected.toLowerCase()
              ? "ring-2 ring-ink"
              : "ring-1 ring-line"
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

function GroupHeader({ parent }: { parent: Parent }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(parent.name);
  const [pickingColor, setPickingColor] = useState(false);
  const saving = useRef(false);

  async function save() {
    if (saving.current) return;
    saving.current = true;
    try {
      const r = await renameParentCategoryAction({
        id: parent.id,
        name: draft,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      saving.current = false;
    }
  }

  async function pickColor(color: string) {
    const r = await setParentColorAction({ id: parent.id, color });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setPickingColor(false);
    router.refresh();
  }

  const activeLeaves = parent.leaves.filter((l) => !l.archived).length;
  const swatchColors = Array.from(new Set([...GROUP_COLORS, parent.color]));

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Change group color"
          aria-expanded={pickingColor}
          onClick={() => setPickingColor((v) => !v)}
          className="size-3 rounded-pill"
          style={{ backgroundColor: parent.color }}
        />
        {editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(parent.name);
                setEditing(false);
              }
            }}
            maxLength={40}
            className="h-7 max-w-48"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(parent.name);
              setEditing(true);
            }}
            className="text-headline font-semibold"
          >
            {parent.name}
          </button>
        )}
        {activeLeaves === 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            title="Removes this group from the list."
            onClick={async () => {
              const r = await archiveParentCategoryAction(parent.id);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              router.refresh();
            }}
          >
            Archive group
          </Button>
        )}
        {parent.leaves.length === 0 && !parent.system && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="Removes this empty group for good."
            onClick={async () => {
              if (!window.confirm(`Delete the group "${parent.name}"?`)) return;
              const r = await deleteParentCategoryAction(parent.id);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success(`Deleted ${parent.name}`);
              router.refresh();
            }}
          >
            Delete group
          </Button>
        )}
      </div>
      {pickingColor && (
        <ColorSwatches
          colors={swatchColors}
          selected={parent.color}
          onPick={pickColor}
        />
      )}
    </div>
  );
}

function AddCategoryRow({ parentId }: { parentId: number }) {
  const router = useRouter();
  const [name, setName] = useState("");

  async function submit() {
    if (!name.trim()) return;
    const r = await addCategoryAction({ parentId, name });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    if (r.warning) toast.warning(r.warning);
    setName("");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2 pt-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Add category…"
        maxLength={40}
        className="h-7 max-w-48"
      />
      <Button type="button" variant="outline" size="sm" onClick={submit}>
        Add
      </Button>
    </div>
  );
}

function NewGroupCard({ tree }: { tree: Tree }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const usedColors = tree.map((p) => p.color);
  const [color, setColor] = useState(() => nextGroupColor(usedColors));

  async function submit() {
    if (!name.trim()) return;
    const r = await addParentCategoryAction({ name, color });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setName("");
    setColor(nextGroupColor([...usedColors, color]));
    router.refresh();
  }

  return (
    <Card>
      <h3 className="mb-2 text-headline font-semibold">New group</h3>
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Group name…"
          maxLength={40}
          className="h-7 max-w-48"
        />
        <Button type="button" variant="outline" size="sm" onClick={submit}>
          Add group
        </Button>
      </div>
      <ColorSwatches colors={GROUP_COLORS} selected={color} onPick={setColor} />
    </Card>
  );
}

export function CategoryManager({ tree }: { tree: Tree }) {
  const targets: MoveTarget[] = tree.flatMap((p) =>
    p.leaves
      .filter((l) => !l.archived)
      .map((l) => ({ id: l.id, label: `${p.name} › ${l.name}` })),
  );
  return (
    <div className="grid gap-4">
      {tree.map((parent) => (
        <Card key={parent.id}>
          {parent.system ? (
            <div className="mb-2 flex items-center gap-2">
              <span
                className="size-3 rounded-pill"
                style={{ backgroundColor: parent.color }}
              />
              <h3 className="text-headline font-semibold">{parent.name}</h3>
            </div>
          ) : (
            <GroupHeader parent={parent} />
          )}
          <div className="divide-y divide-line">
            {parent.leaves.map((leaf) => (
              <CategoryRow
                key={leaf.id}
                leaf={leaf}
                targets={targets.filter((t) => t.id !== leaf.id)}
              />
            ))}
          </div>
          {!parent.system && <AddCategoryRow parentId={parent.id} />}
        </Card>
      ))}
      <NewGroupCard tree={tree} />
    </div>
  );
}
