"use client";

import { useCallback, useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Select, SelectItem } from "@/shared/ui/select";
import * as api from "@/features/workspaces/client/api";
import * as cfApi from "@/features/custom-fields/client/api";
import type { CustomField } from "@/features/custom-fields/types";
import type { Board, WorkspaceMembership, WorkspaceRole } from "@/features/workspaces/types";
import type { CustomFieldPolicy, PermissionGrant } from "../types";
import { usePanelLoad } from "./use-panel-load";

const ROLES: WorkspaceRole[] = ["guest", "viewer", "member", "admin", "owner"];

/**
 * Who may reach what, one section of Settings.
 *
 * Two grants live here because they answer the same question at two grains: a
 * board grant opens a whole board to a role or a person, a field policy narrows
 * one column of one board. Both are enforced in SQL already (permission_grant,
 * custom_field_access_policy); this is the only surface that writes them.
 *
 * Split out of the old admin console, which stacked these on four other topics
 * in one scrolling modal and opened three more modals on top of itself.
 */
export function PermissionsPanel({
  workspace,
  boards,
}: {
  workspace: WorkspaceMembership;
  boards: Board[];
}) {
  const [grants, setGrants] = useState<PermissionGrant[]>([]);
  const [policies, setPolicies] = useState<CustomFieldPolicy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [grantBoardId, setGrantBoardId] = useState("");
  const [grantRole, setGrantRole] = useState<WorkspaceRole>("guest");
  const [grantCapability, setGrantCapability] = useState<"read" | "write" | "manage">("read");

  const [policyBoardId, setPolicyBoardId] = useState("");
  const [boardFields, setBoardFields] = useState<CustomField[]>([]);
  const [policyFieldId, setPolicyFieldId] = useState("");
  const [policyRole, setPolicyRole] = useState<WorkspaceRole>("guest");
  const [policyAccess, setPolicyAccess] = useState<"hidden" | "view" | "edit">("view");

  const load = useCallback(async () => {
    try {
      const [nextGrants, nextPolicies] = await Promise.all([
        api.fetchBoardGrants(workspace.id),
        api.fetchFieldPolicies(workspace.id),
      ]);
      setGrants(nextGrants);
      setPolicies(nextPolicies);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load permissions");
    }
  }, [workspace.id]);

  usePanelLoad(load);

  /**
   * The field picker follows the chosen board, loaded on the pick itself rather
   * than by an effect watching the choice. Picking a board IS the event, so the
   * fetch belongs in the handler: an effect would re-derive the same thing one
   * render later and have to clear the stale field in a second pass.
   */
  function pickPolicyBoard(value: string) {
    setPolicyBoardId(value);
    setPolicyFieldId("");
    if (!value) {
      setBoardFields([]);
      return;
    }
    void cfApi
      .fetchBoardFields(Number(value))
      .then(setBoardFields)
      .catch(() => setBoardFields([]));
  }

  const boardName = new Map(boards.map((b) => [b.id, b.name]));

  async function run(what: string, action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${what}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <section className="grid gap-2">
        <div>
          <h3 className="text-sm font-medium">Board permissions</h3>
          <p className="text-xs text-muted-foreground">
            Open one board to a workspace role. Without a grant a board follows
            the workspace role; guests see only what they are granted.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Board" value={grantBoardId} onValueChange={setGrantBoardId}>
            <SelectItem value="">Choose board</SelectItem>
            {boards.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>
                {b.name}
              </SelectItem>
            ))}
          </Select>
          <Select
            aria-label="Workspace role"
            value={grantRole}
            onValueChange={(value) => setGrantRole(value as WorkspaceRole)}
          >
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </Select>
          <Select
            aria-label="Capability"
            value={grantCapability}
            onValueChange={(value) =>
              setGrantCapability(value as "read" | "write" | "manage")
            }
          >
            {["read", "write", "manage"].map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={busy || !grantBoardId}
            onClick={() =>
              void run("save the board permission", () =>
                api.grantBoardPermission(workspace.id, {
                  subjectId: grantBoardId,
                  principalType: "workspace_role",
                  principalId: grantRole,
                  capability: grantCapability,
                })
              )
            }
          >
            Grant
          </Button>
        </div>
        {grants.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No board permissions — every board follows its workspace roles.
          </p>
        ) : (
          <ul className="grid gap-1">
            {grants.map((g) => (
              <li key={g.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate">
                  {boardName.get(Number(g.subjectId)) ?? `Board #${g.subjectId}`}:{" "}
                  {g.principalId} → {g.capability}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={busy}
                  aria-label="Revoke board permission"
                  onClick={() =>
                    void run("remove the board permission", () =>
                      api.revokeBoardGrant(workspace.id, g.id)
                    )
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-2 border-t pt-5">
        <div>
          <h3 className="text-sm font-medium">Custom field access</h3>
          <p className="text-xs text-muted-foreground">
            Restrict who sees or edits a board&rsquo;s custom field. Without a
            policy every member sees the field; owners and admins always do.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Policy board" value={policyBoardId} onValueChange={pickPolicyBoard}>
            <SelectItem value="">Choose board</SelectItem>
            {boards.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>
                {b.name}
              </SelectItem>
            ))}
          </Select>
          <Select aria-label="Policy field" value={policyFieldId} onValueChange={setPolicyFieldId}>
            <SelectItem value="">Choose field</SelectItem>
            {boardFields.map((f) => (
              <SelectItem key={f.id} value={String(f.id)}>
                {f.name}
              </SelectItem>
            ))}
          </Select>
          <Select
            aria-label="Policy role"
            value={policyRole}
            onValueChange={(value) => setPolicyRole(value as WorkspaceRole)}
          >
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </Select>
          <Select
            aria-label="Policy access"
            value={policyAccess}
            onValueChange={(value) => setPolicyAccess(value as "hidden" | "view" | "edit")}
          >
            <SelectItem value="hidden">hidden</SelectItem>
            <SelectItem value="view">view</SelectItem>
            <SelectItem value="edit">view + edit</SelectItem>
          </Select>
          <Button
            size="sm"
            disabled={busy || !policyFieldId}
            onClick={() =>
              void run("save the field access policy", () =>
                api.saveFieldPolicy(workspace.id, {
                  fieldId: Number(policyFieldId),
                  role: policyRole,
                  canView: policyAccess !== "hidden",
                  canEdit: policyAccess === "edit",
                })
              )
            }
          >
            Set
          </Button>
        </div>
        {policies.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No field policies — every custom field is visible to the whole
            workspace.
          </p>
        ) : (
          <ul className="grid gap-1">
            {policies.map((p) => (
              <li
                key={`${p.fieldId}-${p.role}`}
                className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">
                  {boardName.get(p.boardId) ?? `Board #${p.boardId}`} / {p.fieldName}:{" "}
                  {p.role} → {p.canEdit ? "view + edit" : p.canView ? "view" : "hidden"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={busy}
                  aria-label={`Remove ${p.fieldName} policy for ${p.role}`}
                  onClick={() =>
                    void run("remove the field access policy", () =>
                      api.deleteFieldPolicy(workspace.id, p.fieldId, p.role)
                    )
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
