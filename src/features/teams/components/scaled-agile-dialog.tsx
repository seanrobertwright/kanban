"use client";

import { useEffect, useMemo, useState } from "react";
import { Network } from "lucide-react";

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
import * as api from "../client/api";
import type {
  ArtGroup,
  ScaledAgileOverview,
  SafBoard,
  TeamWithMembers,
} from "../types";

const selectClass =
  "h-7 rounded-md border bg-transparent px-1 text-xs text-foreground";

/**
 * Teams + Scaled Agile / SAFe (044): the workspace read as its layer cake —
 * Portfolio (totals) → ART (program) → Team → Board — in a dialog reached from
 * the header beside Programs and Portfolio. Read-only for a member; an admin
 * creates teams, rosters them, names each board's owning team, and (deletion
 * un-owns, never removes a board).
 */
export function ScaledAgileButton({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ScaledAgileOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newTeam, setNewTeam] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const overview = await api.fetchScaledAgile(workspaceId);
        if (!cancelled) setData(overview);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load scaled agile");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId]);

  async function reload() {
    setData(await api.fetchScaledAgile(workspaceId));
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

  const teams = data?.teams ?? [];
  const totals = data?.portfolio.totals;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Network /> Scaled Agile
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Scaled Agile</DialogTitle>
            <DialogDescription>
              The workspace as a SAFe layer cake — portfolio over its ARTs
              (programs), the teams that deliver them, and which team owns each
              board.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {/* Portfolio — the top layer, totals across every board. */}
          {totals && (
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">Portfolio</span>
              <span className="tabular-nums text-muted-foreground">
                {totals.boards} boards · {totals.done}/{totals.total} done (
                {donePercent(totals.done, totals.total)}%)
                {totals.overdue > 0 && <> · {totals.overdue} overdue</>}
              </span>
            </div>
          )}

          {/* ART layer — programs, each with its boards + owning team. */}
          {data && (
            <section className="grid gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                ARTs · Programs
              </h3>
              {data.arts.length === 0 && (
                <p className="text-sm text-muted-foreground">No boards yet.</p>
              )}
              {data.arts.map((group) => (
                <ArtRow
                  key={group.art?.id ?? "unassigned"}
                  group={group}
                  teams={teams}
                  canManage={canManage}
                  busy={busy}
                  onAssign={(boardId, teamId) =>
                    run(
                      () => api.assignBoardTeam(boardId, teamId),
                      "Could not assign team"
                    )
                  }
                />
              ))}
            </section>
          )}

          {/* Team layer — the roster, with membership + rename/delete. */}
          {data && (
            <section className="grid gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Teams
              </h3>
              {teams.length === 0 && (
                <p className="text-sm text-muted-foreground">No teams yet.</p>
              )}
              {teams.map((team) => (
                <TeamRow
                  key={team.id}
                  team={team}
                  members={data.members}
                  canManage={canManage}
                  busy={busy}
                  run={run}
                />
              ))}

              {canManage && (
                <div className="mt-1 flex items-center gap-1.5">
                  <Input
                    aria-label="New team name"
                    value={newTeam}
                    placeholder="New team…"
                    className="h-8 text-sm"
                    onChange={(e) => setNewTeam(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newTeam.trim()) {
                        run(
                          () => api.createTeam(workspaceId, { name: newTeam.trim() }),
                          "Could not create team"
                        ).then((ok) => ok && setNewTeam(""));
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || !newTeam.trim()}
                    onClick={() =>
                      run(
                        () => api.createTeam(workspaceId, { name: newTeam.trim() }),
                        "Could not create team"
                      ).then((ok) => ok && setNewTeam(""))
                    }
                  >
                    Add team
                  </Button>
                </div>
              )}
            </section>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ArtRow({
  group,
  teams,
  canManage,
  busy,
  onAssign,
}: {
  group: ArtGroup;
  teams: TeamWithMembers[];
  canManage: boolean;
  busy: boolean;
  onAssign: (boardId: number, teamId: number | null) => Promise<boolean>;
}) {
  const title = group.art?.name ?? "Unassigned to an ART";
  return (
    <div className="grid gap-1.5 rounded-lg border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {group.totals.done}/{group.totals.total} done
          {group.totals.overdue > 0 && <> · {group.totals.overdue} overdue</>}
        </span>
      </div>
      {group.boards.map((board) => (
        <BoardLine
          key={board.id}
          board={board}
          teams={teams}
          canManage={canManage}
          busy={busy}
          onAssign={onAssign}
        />
      ))}
    </div>
  );
}

function BoardLine({
  board,
  teams,
  canManage,
  busy,
  onAssign,
}: {
  board: SafBoard;
  teams: TeamWithMembers[];
  canManage: boolean;
  busy: boolean;
  onAssign: (boardId: number, teamId: number | null) => Promise<boolean>;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t pt-1.5 text-xs first:border-t-0 first:pt-0">
      <span className="min-w-0 truncate">{board.name}</span>
      <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
        <span className="tabular-nums">
          {board.done}/{board.total}
        </span>
        {canManage ? (
          <select
            aria-label={`Team for ${board.name}`}
            className={selectClass}
            value={board.teamId ?? ""}
            disabled={busy}
            onChange={(e) =>
              onAssign(board.id, e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <span>{board.teamName ?? "no team"}</span>
        )}
      </div>
    </div>
  );
}

function TeamRow({
  team,
  members,
  canManage,
  busy,
  run,
}: {
  team: TeamWithMembers;
  members: { userId: string; name: string }[];
  canManage: boolean;
  busy: boolean;
  run: (action: () => Promise<unknown>, failure: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(team.name);
  const onTeam = useMemo(
    () => new Set(team.members.map((m) => m.userId)),
    [team.members]
  );
  const addable = members.filter((m) => !onTeam.has(m.userId));

  return (
    <div className="grid gap-1.5 rounded-lg border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        {canManage ? (
          <div className="flex items-center gap-1.5">
            <Input
              aria-label={`Team name for ${team.name}`}
              value={name}
              className="h-7 max-w-40 text-sm"
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-xs"
              disabled={busy || name.trim() === team.name || !name.trim()}
              onClick={() =>
                run(
                  () => api.updateTeam(team.id, { name: name.trim() }),
                  "Could not rename team"
                )
              }
            >
              Rename
            </Button>
          </div>
        ) : (
          <span className="text-sm font-medium">{team.name}</span>
        )}
        {canManage && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={busy}
            onClick={() =>
              run(() => api.deleteTeam(team.id), "Could not delete team")
            }
          >
            Delete
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {team.members.length === 0 && (
          <span className="text-muted-foreground">No members.</span>
        )}
        {team.members.map((m) => (
          <span
            key={m.userId}
            className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5"
          >
            {m.name}
            {canManage && (
              <button
                type="button"
                aria-label={`Remove ${m.name}`}
                className="text-muted-foreground hover:text-destructive disabled:opacity-60"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api.removeTeamMember(team.id, m.userId),
                    "Could not remove member"
                  )
                }
              >
                ×
              </button>
            )}
          </span>
        ))}

        {canManage && addable.length > 0 && (
          <select
            aria-label={`Add member to ${team.name}`}
            className={selectClass}
            value=""
            disabled={busy}
            onChange={(e) => {
              const userId = e.target.value;
              if (userId)
                run(
                  () => api.addTeamMember(team.id, userId),
                  "Could not add member"
                );
            }}
          >
            <option value="">+ Add member…</option>
            {addable.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
