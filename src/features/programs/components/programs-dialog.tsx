"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { donePercent } from "@/features/workspaces/lib/portfolio";
import type { PortfolioBoard } from "@/features/workspaces/types";
import * as api from "../client/api";
import type { Program, ProgramGroup, ProgramsOverview } from "../types";

/**
 * Programs / initiatives (040): the workspace's boards grouped one level up, in a
 * dialog reached from the header beside the Portfolio button. A program gathers
 * projects (boards) into an initiative and rolls their numbers up. Read-only for
 * a member; an admin creates initiatives, renames or deletes them (deletion
 * un-groups, never removes a board), and files boards under them.
 */
export function ProgramsButton({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ProgramsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const overview = await api.fetchPrograms(workspaceId);
        if (!cancelled) setData(overview);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load programs");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId]);

  async function reload() {
    setData(await api.fetchPrograms(workspaceId));
  }

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Every real program, for the per-board reassignment dropdown.
  const programs = useMemo<Program[]>(
    () =>
      (data?.groups ?? [])
        .map((g) => g.program)
        .filter((p): p is Program => p !== null),
    [data]
  );

  async function create() {
    const name = newName.trim();
    if (!name) return;
    const ok = await run(
      () => api.createProgram(workspaceId, { name }),
      "Could not create the program"
    );
    if (ok) setNewName("");
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Boxes /> Programs
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Programs</DialogTitle>
            <DialogDescription>
              Initiatives above the board line — each groups projects and rolls
              their progress up.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {data && data.groups.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No programs yet, and every board is unassigned.
            </p>
          )}

          {data && (
            <div className="grid gap-4">
              {data.groups.map((group) => (
                <ProgramGroupBlock
                  key={group.program?.id ?? "unassigned"}
                  group={group}
                  programs={programs}
                  canManage={canManage}
                  busy={busy}
                  run={run}
                />
              ))}
            </div>
          )}

          {canManage && (
            <div className="flex items-center gap-2 border-t pt-3">
              <Input
                aria-label="New program name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New initiative (e.g. Mobile)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={busy || !newName.trim()}
                onClick={create}
              >
                Add program
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProgramGroupBlock({
  group,
  programs,
  canManage,
  busy,
  run,
}: {
  group: ProgramGroup;
  programs: Program[];
  canManage: boolean;
  busy: boolean;
  run: (action: () => Promise<unknown>, failure: string) => Promise<boolean>;
}) {
  const { program, boards, totals } = group;
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(program?.name ?? "");

  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        {program && renaming ? (
          <div className="flex flex-1 items-center gap-1.5">
            <Input
              aria-label="Program name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 max-w-60 text-sm"
            />
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy || !name.trim()}
              onClick={async () => {
                const ok = await run(
                  () => api.updateProgram(program.id, { name: name.trim() }),
                  "Could not rename the program"
                );
                if (ok) setRenaming(false);
              }}
            >
              Save
            </Button>
          </div>
        ) : (
          <h3 className="text-sm font-semibold">
            {program ? program.name : "Unassigned"}
          </h3>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {totals.boards} {totals.boards === 1 ? "board" : "boards"} ·{" "}
            {totals.done}/{totals.total} done
            {totals.overdue > 0 && (
              <span className="ml-1 text-destructive">
                · {totals.overdue} overdue
              </span>
            )}
          </span>
          {canManage && program && !renaming && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs text-muted-foreground"
                disabled={busy}
                onClick={() => {
                  setName(program.name);
                  setRenaming(true);
                }}
              >
                Rename
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                disabled={busy}
                onClick={() =>
                  confirming
                    ? run(
                        () => api.deleteProgram(program.id),
                        "Could not delete the program"
                      )
                    : setConfirming(true)
                }
                onBlur={() => setConfirming(false)}
              >
                {confirming ? "Really?" : "Delete"}
              </Button>
            </>
          )}
        </div>
      </div>

      {boards.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          No boards {program ? "in this program" : "unassigned"}.
        </p>
      ) : (
        <div className="grid gap-2">
          {boards.map((board) => (
            <BoardRow
              key={board.id}
              board={board}
              currentProgramId={program?.id ?? null}
              programs={programs}
              canManage={canManage}
              busy={busy}
              run={run}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BoardRow({
  board,
  currentProgramId,
  programs,
  canManage,
  busy,
  run,
}: {
  board: PortfolioBoard;
  currentProgramId: number | null;
  programs: Program[];
  canManage: boolean;
  busy: boolean;
  run: (action: () => Promise<unknown>, failure: string) => Promise<boolean>;
}) {
  const pct = donePercent(board.done, board.total);
  return (
    <div className="grid gap-1.5 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <a
          href={`/?board=${board.id}`}
          className="truncate font-medium hover:underline"
        >
          {board.name}
        </a>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {board.hasDoneColumn ? (
            <>
              {board.done}/{board.total} · {pct}%
            </>
          ) : (
            <>{board.total} tasks</>
          )}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        {board.hasDoneColumn && (
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {canManage && (
        <select
          aria-label={`Program for ${board.name}`}
          className="mt-0.5 h-7 rounded-md border bg-transparent px-1 text-xs text-foreground"
          value={currentProgramId ?? ""}
          disabled={busy}
          onChange={(e) =>
            run(
              () =>
                api.assignBoardProgram(
                  board.id,
                  e.target.value === "" ? null : Number(e.target.value)
                ),
              "Could not move the board"
            )
          }
        >
          <option value="">Unassigned</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
