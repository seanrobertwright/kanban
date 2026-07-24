"use client";

import { Bot, Shield, Trash2, Users, Webhook } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import type { Board, WorkspaceMembership, WorkspaceRole } from "@/features/workspaces/types";
import * as api from "@/features/workspaces/client/api";
import { AgentsDialog } from "@/features/agents/components/agents-dialog";
import { WebhooksDialog } from "@/features/webhooks/components/webhooks-dialog";
import { MembersDialog } from "@/features/workspaces/components/members-dialog";
import type { AdminSummary, IpAllowlistEntry, PermissionGrant } from "../types";
import { EnterpriseControls } from "./enterprise-controls";

export function AdminConsoleButton({ workspace, currentUserId, boards }: { workspace: WorkspaceMembership; currentUserId: string; boards: Board[] }) {
  if (workspace.role !== "owner" && workspace.role !== "admin") return null;
  return <AdminConsoleControl workspace={workspace} currentUserId={currentUserId} boards={boards} />;
}

function AdminConsoleControl({ workspace, currentUserId, boards }: { workspace: WorkspaceMembership; currentUserId: string; boards: Board[] }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" size="icon" aria-label="Admin console" title="Admin console" onClick={() => setOpen(true)}><Shield /></Button><AdminConsoleDialog workspace={workspace} currentUserId={currentUserId} boards={boards} open={open} onOpenChange={setOpen} /></>;
}

function AdminConsoleDialog({ workspace, currentUserId, boards, open, onOpenChange }: { workspace: WorkspaceMembership; currentUserId: string; boards: Board[]; open: boolean; onOpenChange(open: boolean): void }) {
  const [entries, setEntries] = useState<IpAllowlistEntry[]>([]);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [grants, setGrants] = useState<PermissionGrant[]>([]);
  const [grantBoardId, setGrantBoardId] = useState(""); const [grantRole, setGrantRole] = useState<WorkspaceRole>("guest"); const [grantCapability, setGrantCapability] = useState<"read" | "write" | "manage">("read");
  const [cidr, setCidr] = useState(""); const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false); const [agentsOpen, setAgentsOpen] = useState(false); const [webhooksOpen, setWebhooksOpen] = useState(false);
  const load = useCallback(async () => { try { const [nextSummary, nextEntries, nextGrants] = await Promise.all([api.fetchAdminSummary(workspace.id), api.fetchIpAllowlist(workspace.id), api.fetchBoardGrants(workspace.id)]); setSummary(nextSummary); setEntries(nextEntries); setGrants(nextGrants); } catch (e) { setError(e instanceof Error ? e.message : "Could not load admin settings"); } }, [workspace.id]);
  useEffect(() => {
    if (!open) return;
    // Defer the request until after the dialog has committed. This avoids a
    // render-phase update while still refreshing on every open.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [open, load]);
  async function add() { setBusy(true); setError(null); try { await api.addIpAllowlistEntry(workspace.id, cidr, label); setCidr(""); setLabel(""); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save network policy"); } finally { setBusy(false); } }
  async function remove(id: number) { setBusy(true); setError(null); try { await api.deleteIpAllowlistEntry(workspace.id, id); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove network policy"); } finally { setBusy(false); } }
  async function addGrant() { if (!grantBoardId) return; setBusy(true); setError(null); try { await api.grantBoardPermission(workspace.id, { subjectId: grantBoardId, principalType: "workspace_role", principalId: grantRole, capability: grantCapability }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save board permission"); } finally { setBusy(false); } }
  async function removeGrant(id: string) { setBusy(true); setError(null); try { await api.revokeBoardGrant(workspace.id, id); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove board permission"); } finally { setBusy(false); } }
  const owner = workspace.role === "owner";
  return <><Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Admin console</DialogTitle><DialogDescription>Central workspace administration for {workspace.name}.</DialogDescription></DialogHeader>{summary && <div className="grid grid-cols-2 gap-2 border-y py-3 text-sm"><p><b>{summary.members}</b> members</p><p><b>{summary.agents}</b> agents</p><p><b>{summary.boards}</b> boards</p><p><b>{summary.webhooks}</b> active webhooks</p><p className="col-span-2"><b>{summary.auditEvents}</b> audit events</p></div>}<div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setMembersOpen(true)}><Users /> Members</Button><Button variant="outline" size="sm" onClick={() => setAgentsOpen(true)}><Bot /> Agents</Button><Button variant="outline" size="sm" onClick={() => setWebhooksOpen(true)}><Webhook /> Webhooks</Button></div><section className="grid gap-2 border-t pt-3"><h3 className="text-sm font-medium">Board permissions</h3><div className="flex gap-2"><select aria-label="Board" value={grantBoardId} onChange={e=>setGrantBoardId(e.target.value)}><option value="">Choose board</option>{boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><select aria-label="Workspace role" value={grantRole} onChange={e=>setGrantRole(e.target.value as WorkspaceRole)}>{["guest","viewer","member","admin","owner"].map(r=><option key={r}>{r}</option>)}</select><select aria-label="Capability" value={grantCapability} onChange={e=>setGrantCapability(e.target.value as "read"|"write"|"manage")}>{["read","write","manage"].map(c=><option key={c}>{c}</option>)}</select><Button size="sm" disabled={busy||!grantBoardId} onClick={addGrant}>Grant</Button></div>{grants.map(g=><div key={g.id} className="flex gap-2 text-xs"><span className="flex-1">Board #{g.subjectId}: {g.principalId} → {g.capability}</span><Button variant="ghost" size="icon" className="size-6" disabled={busy} aria-label="Revoke board permission" onClick={()=>removeGrant(g.id)}><Trash2 /></Button></div>)}</section><section className="grid gap-3"><div><h3 className="text-sm font-medium">IP allowlist</h3><p className="text-xs text-muted-foreground">Enforcement is active only when the deployment enables it with a trusted proxy header. See enterprise deployment notes.</p></div>{!owner && <p className="text-xs text-muted-foreground">Only workspace owners can change this policy.</p>}{owner && <div className="grid gap-2"><Label htmlFor="allow-cidr">CIDR range</Label><div className="flex gap-2"><Input id="allow-cidr" value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="203.0.113.0/24" /><Input aria-label="Range label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Office (optional)" /><Button disabled={busy || !cidr.trim()} onClick={add}>Add</Button></div></div>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}<div className="grid gap-1">{entries.length === 0 ? <p className="text-sm text-muted-foreground">No network restrictions.</p> : entries.map((entry) => <div key={entry.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"><code className="flex-1">{entry.cidr}</code><span className="text-xs text-muted-foreground">{entry.label}</span>{owner && <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove ${entry.cidr}`} disabled={busy} onClick={() => remove(entry.id)}><Trash2 /></Button>}</div>)}</div></section><EnterpriseControls workspace={workspace} /></DialogContent></Dialog><MembersDialog open={membersOpen} onOpenChange={setMembersOpen} workspace={workspace} currentUserId={currentUserId} /><AgentsDialog open={agentsOpen} onOpenChange={setAgentsOpen} workspace={workspace} /><WebhooksDialog open={webhooksOpen} onOpenChange={setWebhooksOpen} workspace={workspace} /></>;
}
