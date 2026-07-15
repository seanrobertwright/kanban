"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail, X } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import * as api from "../client/api";
import type { Invitation, Member, WorkspaceMembership, WorkspaceRole } from "../types";

const ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

const ROLE_HINT: Record<WorkspaceRole, string> = {
  owner: "Full control, including members and deletion",
  admin: "Manage boards and members",
  member: "Create and edit tasks",
  viewer: "Read-only",
};

interface MembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: WorkspaceMembership;
  currentUserId: string;
}

const selectClass =
  "h-8 rounded-md border bg-background px-2 text-xs capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

export function MembersDialog({
  open,
  onOpenChange,
  workspace,
  currentUserId,
}: MembersDialogProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [inviting, setInviting] = useState(false);

  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const isOwner = workspace.role === "owner";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.fetchMembers(workspace.id);
      setMembers(data.members);
      setInvitations(data.invitations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    setError(null);
    try {
      await api.inviteMember(workspace.id, email.trim(), role);
      setEmail("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to invite");
    } finally {
      setInviting(false);
    }
  }

  // Every mutation reloads rather than patching local state: the server may have
  // refused (last owner) or changed more than one row, and the roster is small.
  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Members</DialogTitle>
          <DialogDescription>
            Who can access {workspace.name}.
          </DialogDescription>
        </DialogHeader>

        {isAdmin && (
          <form onSubmit={handleInvite} className="grid gap-2">
            <Label htmlFor="invite-email">Invite by email</Label>
            <div className="flex gap-2">
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="flex-1"
              />
              <select
                aria-label="Invite role"
                className={cn(selectClass, "h-9")}
                value={role}
                onChange={(e) => setRole(e.target.value as WorkspaceRole)}
              >
                {ROLES.filter((r) => isOwner || r !== "owner").map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <Button type="submit" disabled={inviting || !email.trim()}>
                {inviting ? <Loader2 className="animate-spin" /> : "Invite"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {/* Be honest rather than implying an email went out. */}
              No email is sent yet — they join automatically the next time they
              sign in with this address.
            </p>
          </form>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}

        <div className="grid gap-1">
          {loading && members.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : (
            members.map((member) => (
              <div
                key={member.userId}
                className="flex items-center gap-3 rounded-lg px-1 py-1.5"
              >
                <Avatar className="size-7">
                  <AvatarImage src={member.image ?? undefined} alt={member.name} />
                  <AvatarFallback className="text-xs">
                    {member.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {member.name}
                    {member.userId === currentUserId && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        you
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {member.email}
                  </span>
                </div>

                {isAdmin ? (
                  <select
                    aria-label={`Role for ${member.name}`}
                    className={selectClass}
                    value={member.role}
                    // The server enforces all of this too; disabling here just
                    // avoids offering an action that will be refused.
                    disabled={member.role === "owner" && !isOwner}
                    onChange={(e) =>
                      run(() =>
                        api.updateMemberRole(
                          workspace.id,
                          member.userId,
                          e.target.value as WorkspaceRole
                        )
                      )
                    }
                  >
                    {ROLES.filter((r) => isOwner || r !== "owner").map((r) => (
                      <option key={r} value={r} title={ROLE_HINT[r]}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs capitalize text-muted-foreground">
                    {member.role}
                  </span>
                )}

                {(isAdmin || member.userId === currentUserId) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground"
                    aria-label={
                      member.userId === currentUserId
                        ? "Leave workspace"
                        : `Remove ${member.name}`
                    }
                    disabled={member.role === "owner" && !isOwner}
                    onClick={() =>
                      run(() => api.removeMember(workspace.id, member.userId))
                    }
                  >
                    <X />
                  </Button>
                )}
              </div>
            ))
          )}
        </div>

        {invitations.length > 0 && (
          <div className="grid gap-1 border-t pt-3">
            <p className="px-1 text-xs font-medium text-muted-foreground">
              Pending invitations
            </p>
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex items-center gap-3 rounded-lg px-1 py-1.5"
              >
                <div className="flex size-7 items-center justify-center rounded-full bg-muted">
                  <Mail className="size-3.5 text-muted-foreground" />
                </div>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {invitation.email}
                </span>
                <span className="text-xs capitalize text-muted-foreground">
                  {invitation.role}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground"
                  aria-label={`Revoke invitation for ${invitation.email}`}
                  onClick={() => run(() => api.revokeInvitation(invitation.id))}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
