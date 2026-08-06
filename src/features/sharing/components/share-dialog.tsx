"use client";

import { EmptyState } from "@/shared/ui/empty-state";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, X } from "lucide-react";

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
import { Select, SelectItem } from "@/shared/ui/select";
import { fetchMembers } from "@/features/workspaces/client/api";
import type { Member } from "@/features/workspaces/types";
import * as api from "../client/api";
import { publicPathForToken, type ShareSubject } from "../types";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being shared. Forms mint submit links; boards and docs read links. */
  subjectType: Exclude<ShareSubject, "view">;
  subjectId: string;
  /** Named in the header so the admin knows which object they are exposing. */
  subjectName: string;
  /** For the guest-share member picker. */
  workspaceId: string;
}

/**
 * The admin surface over the sharing machinery (061): public links (mint with
 * optional expiry, copy, revoke) and per-object guest shares (grant a workspace
 * member — typically a guest — access to just this object). The server admits
 * only workspace admins to every call here; this dialog is mounted behind the
 * same gate and surfaces the server's refusal if the gate was wrong.
 */
export function ShareDialog({
  open,
  onOpenChange,
  subjectType,
  subjectId,
  subjectName,
  workspaceId,
}: ShareDialogProps) {
  const [links, setLinks] = useState<api.PublicLink[]>([]);
  const [shares, setShares] = useState<api.ObjectShare[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expiryDays, setExpiryDays] = useState("");
  const [grantee, setGrantee] = useState("");
  const [granteeCanEdit, setGranteeCanEdit] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // A form or feedback link is a submit capability; boards and docs expose
  // read-only pages.
  const scope = subjectType === "form" || subjectType === "feedback" ? "submit" : "read";

  // A feedback portal is an anonymous door with nobody on the other side: there
  // is no object to grant a named guest, and object_share's CHECK does not admit
  // one. The section is hidden rather than shown-and-failing.
  const guestShareable = subjectType !== "feedback";

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextLinks, nextShares, roster] = await Promise.all([
        api.fetchPublicLinks(subjectType, subjectId),
        guestShareable
          ? api.fetchObjectShares(subjectType, subjectId)
          : Promise.resolve([]),
        guestShareable ? fetchMembers(workspaceId) : Promise.resolve({ members: [] }),
      ]);
      setLinks(nextLinks);
      setShares(nextShares);
      setMembers(roster.members);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load shares");
    }
  }, [subjectType, subjectId, workspaceId, guestShareable]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
    } finally {
      setBusy(false);
    }
  }

  function mint() {
    const days = expiryDays.trim() === "" ? null : Number(expiryDays);
    if (days !== null && (!Number.isFinite(days) || days <= 0)) {
      setError("Expiry must be a positive number of days");
      return;
    }
    const expiresAt =
      days === null
        ? null
        : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    void run(
      () => api.mintPublicLink(subjectType, subjectId, scope, expiresAt),
      "Could not create the link"
    ).then(() => setExpiryDays(""));
  }

  async function copy(link: api.PublicLink) {
    const url = `${window.location.origin}${publicPathForToken(subjectType, link.token)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((prev) => (prev === link.id ? null : prev)), 1500);
    } catch {
      setError("Could not copy — copy the URL manually");
    }
  }

  // Members already holding a share need no second grant row offered.
  const grantable = members.filter((m) => !shares.some((s) => s.userId === m.userId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription>
            {guestShareable
              ? `Public links and guest access for ${subjectName}.`
              : `An anonymous feedback portal for ${subjectName}.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Public links — anyone with the URL{" "}
            {subjectType === "feedback"
              ? "can send feedback, and see nothing else"
              : scope === "submit"
                ? "can submit this form"
                : "can view, read-only"}
          </p>
          {links.length === 0 ? (
            <EmptyState icon={Link2} dense title="No public links yet" hint="A public link lets someone without an account read this. Revoke it whenever you like." />
          ) : (
            <ul className="grid gap-1">
              {links.map((link) => (
                <li key={link.id} className="flex items-center gap-2 rounded-lg border px-2 py-1.5">
                  <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {publicPathForToken(subjectType, link.token)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {link.expiresAt
                      ? `expires ${new Date(link.expiresAt).toLocaleDateString()}`
                      : "no expiry"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground"
                    aria-label={`Copy link ${link.id}`}
                    onClick={() => void copy(link)}
                  >
                    {copiedId === link.id ? <Check /> : <Copy />}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    aria-label={`Revoke link ${link.id}`}
                    disabled={busy}
                    onClick={() =>
                      run(() => api.revokePublicLink(link.id), "Could not revoke the link")
                    }
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor="share-expiry" className="text-xs">
                Expires in days (blank = never)
              </Label>
              <Input
                id="share-expiry"
                type="number"
                min="1"
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value)}
                placeholder="30"
                className="h-8 w-40"
              />
            </div>
            <Button type="button" size="sm" disabled={busy} onClick={mint}>
              Create link
            </Button>
          </div>
        </div>

        {guestShareable && (
        <div className="grid gap-2 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            Guest access — share just this {subjectType} with a workspace member
          </p>
          {shares.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not shared with anyone.</p>
          ) : (
            <ul className="grid gap-1">
              {shares.map((share) => (
                <li key={share.userId} className="flex items-center gap-2 rounded-lg px-1 py-1">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-sm">{share.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{share.email}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {share.canEdit ? "can edit" : "read-only"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground"
                    aria-label={`Revoke access for ${share.name}`}
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api.revokeObjectShare(subjectType, subjectId, share.userId),
                        "Could not revoke access"
                      )
                    }
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <Select
              aria-label="Share with member"
              className="h-8 flex-1 rounded-md px-2 text-xs"
              value={grantee}
              onValueChange={(value) => setGrantee(value)}
            >
              <SelectItem value="">Choose a member…</SelectItem>
              {grantable.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {`${m.name} (${m.email})`}
                </SelectItem>
              ))}
            </Select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                aria-label="Grant edit access"
                checked={granteeCanEdit}
                onChange={(e) => setGranteeCanEdit(e.target.checked)}
              />
              can edit
            </label>
            <Button
              type="button"
              size="sm"
              disabled={busy || grantee === ""}
              onClick={() =>
                run(
                  () => api.grantObjectShare(subjectType, subjectId, grantee, granteeCanEdit),
                  "Could not share"
                ).then(() => {
                  setGrantee("");
                  setGranteeCanEdit(false);
                })
              }
            >
              Share
            </Button>
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
