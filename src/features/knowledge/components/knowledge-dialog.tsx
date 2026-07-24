"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import type { KnowledgeAnswer } from "../types";

export function KnowledgeButton({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)}><Sparkles /> Ask</Button><KnowledgeDialog workspaceId={workspaceId} open={open} onOpenChange={setOpen} /></>;
}

function KnowledgeDialog({ workspaceId, open, onOpenChange }: { workspaceId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<KnowledgeAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function ask() {
    if (!question.trim()) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/knowledge-query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not search workspace knowledge");
      setResult(payload as KnowledgeAnswer);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not search workspace knowledge"); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Workspace Q&A</DialogTitle><DialogDescription>Searches authorized tasks, comments, and published documents. Every answer is backed by citations.</DialogDescription></DialogHeader><div className="flex gap-2"><Input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void ask(); }} placeholder="What is blocking the launch?" aria-label="Workspace question" /><Button disabled={busy || !question.trim()} onClick={() => void ask()}>{busy ? "Searching…" : "Ask"}</Button></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{result && <div className="grid gap-3"><p className="whitespace-pre-line rounded border bg-muted/40 p-3 text-sm">{result.answer}</p><div className="grid gap-2"><p className="text-xs font-medium text-muted-foreground">Sources</p>{result.citations.map((citation) => <div key={`${citation.kind}-${citation.id}`} className="rounded border p-2 text-xs"><p className="font-medium">{citation.kind} · {citation.title}</p>{citation.excerpt && <p className="mt-1 text-muted-foreground">{citation.excerpt}</p>}</div>)}</div></div>}</DialogContent></Dialog>;
}
