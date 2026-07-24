"use client";

import { BookOpen, FilePlus2, History, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { RichText } from "@/shared/ui/rich-text";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import * as api from "../client/api";
import { CollaborativeEditor } from "./collaborative-editor";
import type { Doc, DocKind, DocRevision, MeetingAction } from "../types";

const TEMPLATES: Record<DocKind, { title: string; body: string }> = {
  page: { title: "Untitled page", body: "" },
  meeting: { title: "Meeting notes", body: "# Attendees\n\n# Agenda\n\n# Notes\n\n# Action items\n- [ ] " },
  decision: { title: "Decision", body: "# Context\n\n# Decision\n\n# Rationale\n\n# Status\nProposed" },
};

export function DocsButton({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)}><BookOpen /> Docs</Button><DocsDialog workspaceId={workspaceId} canManage={canManage} open={open} onOpenChange={setOpen} /></>;
}

function DocsDialog({ workspaceId, canManage, open, onOpenChange }: { workspaceId: string; canManage: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selected, setSelected] = useState<Doc | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [search, setSearch] = useState("");
  const [decisionOnly, setDecisionOnly] = useState(false);
  const [revisions, setRevisions] = useState<DocRevision[] | null>(null);
  const [actions, setActions] = useState<MeetingAction[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choose(doc: Doc | null) { setSelected(doc); setTitle(doc?.title ?? ""); setBody(doc?.body ?? ""); setPreview(false); setRevisions(null); setActions(null); }
  async function load() { try { const next = await api.fetchDocs(workspaceId); setDocs(next); choose(next.find((doc) => doc.id === selected?.id) ?? next[0] ?? null); } catch (e) { setError(e instanceof Error ? e.message : "Could not load docs"); } }
  useEffect(() => { if (!open) return; const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [open, workspaceId]);
  const visible = useMemo(() => { const term = search.trim().toLowerCase(); return docs.filter((doc) => (!decisionOnly || doc.kind === "decision") && (!term || `${doc.title}\n${doc.body}`.toLowerCase().includes(term))); }, [docs, search, decisionOnly]);
  const resolvedPreview = useMemo(() => body.replace(/\[\[([^\]]+)\]\]/g, (_match, title: string) => { const doc = docs.find((item) => item.title.toLowerCase() === title.trim().toLowerCase()); return doc ? `[${doc.title}](#doc-${doc.id})` : `[[${title}]]`; }), [body, docs]);

  async function add(kind: DocKind) { setBusy(true); setError(null); try { const doc = await api.createDoc(workspaceId, { ...TEMPLATES[kind], kind }); setDocs((old) => [...old, doc]); choose(doc); } catch (e) { setError(e instanceof Error ? e.message : "Could not create document"); } finally { setBusy(false); } }
  async function save() { if (!selected || !title.trim()) return; setBusy(true); setError(null); try { const doc = await api.updateDoc(selected.id, { title, body }); setDocs((old) => old.map((item) => item.id === doc.id ? doc : item)); choose(doc); } catch (e) { setError(e instanceof Error ? e.message : "Could not save document"); } finally { setBusy(false); } }
  async function remove() { if (!selected) return; setBusy(true); try { await api.deleteDoc(selected.id); const next = docs.filter((doc) => doc.id !== selected.id); setDocs(next); choose(next[0] ?? null); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete document"); } finally { setBusy(false); } }
  async function history() { if (!selected) return; try { setRevisions(await api.fetchRevisions(selected.id)); } catch (e) { setError(e instanceof Error ? e.message : "Could not load revision history"); } }
  async function promoteAction() { if (!selected) return; const action = body.match(/^\s*- \[[ xX]\]\s+(.+)$/m)?.[1]; if (!action) { setError("Add an action item like: - [ ] Follow up"); return; } try { const response = await fetch(`/api/docs/${selected.id}/promote-action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: action }) }); if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Could not promote action"); } catch (e) { setError(e instanceof Error ? e.message : "Could not promote action"); } }
  async function extractActions() { if (!selected) return; try { setActions(await api.fetchMeetingActions(selected.id)); } catch (e) { setError(e instanceof Error ? e.message : "Could not extract actions"); } }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-5xl"><DialogHeader><DialogTitle>Docs</DialogTitle><DialogDescription>Workspace pages, meeting notes, decisions, and published knowledge.</DialogDescription></DialogHeader>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="grid min-h-96 grid-cols-[12rem_minmax(0,1fr)] gap-4"><aside className="grid content-start gap-2 border-r pr-3"><div className="flex gap-1"><Input aria-label="Search documents" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" /><Search className="mt-2 size-4 text-muted-foreground" /></div><Button size="sm" variant={decisionOnly?"secondary":"ghost"} onClick={()=>setDecisionOnly(v=>!v)}>Decisions</Button>{canManage && <div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" disabled={busy} onClick={() => void add("page")}><FilePlus2 /> Page</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void add("meeting")}>Meeting</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void add("decision")}>Decision</Button></div>}<div className="grid gap-1 pt-2">{visible.map((doc) => <button key={doc.id} id={`doc-${doc.id}`} type="button" className={`rounded px-2 py-1 text-left text-sm ${selected?.id === doc.id ? "bg-muted font-medium" : "hover:bg-muted/60"}`} onClick={() => choose(doc)}>{doc.title}<span className="ml-1 text-xs text-muted-foreground">{doc.kind}</span></button>)}</div></aside><section className="grid content-start gap-3">{selected ? <><div className="flex gap-2"><Input aria-label="Document title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canManage} /><Button size="sm" variant="ghost" onClick={() => setPreview((value) => !value)}>{preview ? "Write" : "Preview"}</Button><Button size="sm" variant="ghost" onClick={() => void history()}><History /> History</Button>{selected.kind === "meeting" && canManage && <><Button size="sm" variant="ghost" onClick={() => void extractActions()}>Review actions</Button><Button size="sm" variant="ghost" onClick={() => void promoteAction()}>Promote action</Button></>}</div>{preview ? <RichText text={resolvedPreview} className="min-h-64 rounded border p-3" /> : <CollaborativeEditor key={selected.id} docId={selected.id} initialBody={selected.body} disabled={!canManage} onChange={setBody} />}{actions&&<div className="rounded border p-2 text-xs"><strong>Proposed action items</strong>{actions.length===0?<p className="text-muted-foreground">No unchecked Markdown actions found.</p>:actions.map(a=><p key={a.title}>• {a.title}{a.ownerHint?` · owner: ${a.ownerHint}`:""}{a.dueDate?` · due: ${a.dueDate}`:""}</p>)}</div>}{revisions && <div className="rounded border p-2 text-xs"><strong>History</strong>{revisions.length === 0 ? <p className="text-muted-foreground">No saved revisions yet.</p> : revisions.map((revision) => <p key={revision.id}>{new Date(revision.createdAt).toLocaleString()} — {revision.editedBy}</p>)}</div>}{canManage && <div className="flex justify-between"><Button size="sm" disabled={busy || !title.trim()} onClick={() => void save()}>Save</Button><Button size="sm" variant="ghost" disabled={busy} className="text-destructive" onClick={() => void remove()}>Delete</Button></div>}</> : <p className="text-sm text-muted-foreground">Create a page to start the wiki.</p>}</section></div></DialogContent></Dialog>;
}
