"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, X } from "lucide-react";

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
import { Textarea } from "@/shared/ui/textarea";
import type { WorkspaceMembership, WorkspaceRole } from "@/features/workspaces/types";
import * as api from "../client/api";
import type { AgentDetail, AgentKind, WorkspaceBudget } from "../types";

const MICROS_PER_DOLLAR = 1_000_000;

/** Roles an agent can hold — owner is offered only to an owner (parity with the
 *  members dialog; the server refuses the rest). */
const ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

const selectClass =
  "h-9 rounded-md border bg-background px-2 text-xs capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

interface AgentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: WorkspaceMembership;
}

function formatDollars(micros: number): string {
  return `$${(micros / MICROS_PER_DOLLAR).toFixed(2)}`;
}

export function AgentsDialog({ open, onOpenChange, workspace }: AgentsDialogProps) {
  const [agents, setAgents] = useState<AgentDetail[]>([]);
  const [budget, setBudget] = useState<WorkspaceBudget | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AgentKind>("external");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [model, setModel] = useState("claude-opus-4-8");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  /** A freshly-minted external token — shown once, then dismissed by hand. */
  const [mintedToken, setMintedToken] = useState<string | null>(null);

  // Budget field, in dollars as the operator types it.
  const [capInput, setCapInput] = useState("");
  const [savingBudget, setSavingBudget] = useState(false);

  const isOwner = workspace.role === "owner";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentList, b] = await Promise.all([
        api.fetchAgents(workspace.id),
        api.fetchBudget(workspace.id),
      ]);
      setAgents(agentList);
      setBudget(b);
      setCapInput(
        b.capMicros === null ? "" : String(b.capMicros / MICROS_PER_DOLLAR)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createAgent(workspace.id, {
        name: name.trim(),
        role,
        kind,
        model: kind === "native" ? model.trim() : null,
        systemPrompt: kind === "native" && prompt.trim() ? prompt : null,
      });
      // The external token exists exactly once, in this response. Hold it on
      // screen until the operator dismisses it — a reload can never fetch it back.
      setMintedToken(created.token ?? null);
      setName("");
      setPrompt("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(agent: AgentDetail) {
    setError(null);
    try {
      await api.deleteAgent(workspace.id, agent.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete agent");
    }
  }

  async function handleSaveBudget(capMicros: number | null) {
    setSavingBudget(true);
    setError(null);
    try {
      const b = await api.setBudget(workspace.id, capMicros);
      setBudget(b);
      setCapInput(
        b.capMicros === null ? "" : String(b.capMicros / MICROS_PER_DOLLAR)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save budget");
    } finally {
      setSavingBudget(false);
    }
  }

  function submitBudget(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = capInput.trim();
    if (trimmed === "") return handleSaveBudget(null);
    const dollars = Number(trimmed);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError("Budget must be a non-negative dollar amount");
      return;
    }
    handleSaveBudget(Math.round(dollars * MICROS_PER_DOLLAR));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agents</DialogTitle>
          <DialogDescription>
            AI agents that hold and act on tasks in {workspace.name}.
          </DialogDescription>
        </DialogHeader>

        {/* Budget — §7.3's cap, in dollars. Empty = uncapped. */}
        <form onSubmit={submitBudget} className="grid gap-2 rounded-lg border p-3">
          <Label htmlFor="agent-budget">Monthly budget cap</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              id="agent-budget"
              inputMode="decimal"
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
              placeholder="Uncapped"
              className="flex-1"
            />
            <Button type="submit" variant="secondary" disabled={savingBudget}>
              {savingBudget ? <Loader2 className="animate-spin" /> : "Save"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {budget
              ? `Spent this month: ${formatDollars(budget.spentMicros)}${
                  budget.capMicros === null
                    ? " · no cap — a runaway run can spend freely"
                    : ""
                }`
              : "Loading…"}
          </p>
        </form>

        {/* Create — external (Door 2) or native (Door 1). */}
        <form onSubmit={handleCreate} className="grid gap-2 border-t pt-3">
          <Label htmlFor="agent-name">Add an agent</Label>
          <div className="flex gap-2">
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Triage Bot"
              className="flex-1"
            />
            <select
              aria-label="Agent kind"
              className={selectClass}
              value={kind}
              onChange={(e) => setKind(e.target.value as AgentKind)}
            >
              <option value="external">external (MCP)</option>
              <option value="native">native (hosted)</option>
            </select>
            <select
              aria-label="Agent role"
              className={selectClass}
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
            >
              {ROLES.filter((r) => isOwner || r !== "owner").map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {kind === "native" && (
            <>
              <Input
                aria-label="Model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="claude-opus-4-8"
              />
              <Textarea
                aria-label="System prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="System prompt (optional)"
                rows={3}
              />
            </>
          )}

          <Button
            type="submit"
            disabled={creating || !name.trim() || (kind === "native" && !model.trim())}
          >
            {creating ? <Loader2 className="animate-spin" /> : "Create agent"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {kind === "external"
              ? "An external agent connects over MCP with a token shown once at creation."
              : "A native agent is driven by us — assign it a task to start a run. No token."}
          </p>
        </form>

        {mintedToken && (
          <div className="grid gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
            <p className="text-xs font-medium">
              Agent key — copy it now. It is shown once and cannot be recovered.
            </p>
            <code className="block overflow-x-auto rounded bg-background px-2 py-1.5 font-mono text-xs">
              {mintedToken}
            </code>
            <Button
              variant="secondary"
              size="sm"
              className="justify-self-end"
              onClick={() => setMintedToken(null)}
            >
              Done
            </Button>
          </div>
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
          {loading && agents.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
          ) : agents.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No agents yet.
            </p>
          ) : (
            agents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-3 rounded-lg px-1 py-1.5"
              >
                <Avatar className="size-7">
                  <AvatarImage src={agent.image ?? undefined} alt={agent.name} />
                  <AvatarFallback className="bg-primary/10">
                    <Bot className="size-3.5" />
                  </AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm font-medium">{agent.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {agent.kind === "native"
                      ? `native · ${agent.model ?? "—"}`
                      : "external · MCP"}
                  </span>
                </div>
                <span className="text-xs capitalize text-muted-foreground">
                  {agent.role}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground"
                  aria-label={`Delete ${agent.name}`}
                  onClick={() => handleDelete(agent)}
                >
                  <X />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
