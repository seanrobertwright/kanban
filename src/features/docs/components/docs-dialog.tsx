"use client";

import { EmptyState } from "@/shared/ui/empty-state";
import { BookOpen, FilePlus2, FileText, Globe, History, Search, Share2 } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";

import { RichText } from "@/shared/ui/rich-text";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Select, SelectItem } from "@/shared/ui/select";
import * as api from "../client/api";
import { ShareDialog } from "@/features/sharing/components/share-dialog";
import { CollaborativeEditor } from "./collaborative-editor";
import { buildDocTree, descendantIds, flattenDocTree } from "../lib/tree";
import { brokenWikiLinks, docIdFromAnchor, resolveWikiLinks } from "../lib/wiki-links";
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
  const [shareOpen, setShareOpen] = useState(false);

  function choose(doc: Doc | null) { setSelected(doc); setTitle(doc?.title ?? ""); setBody(doc?.body ?? ""); setPreview(false); setRevisions(null); setActions(null); }
  async function load() { try { const next = await api.fetchDocs(workspaceId); setDocs(next); choose(next.find((doc) => doc.id === selected?.id) ?? next[0] ?? null); } catch (e) { setError(e instanceof Error ? e.message : "Could not load docs"); } }
  useEffect(() => { if (!open) return; const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [open, workspaceId]);
  const visible = useMemo(() => { const term = search.trim().toLowerCase(); return docs.filter((doc) => (!decisionOnly || doc.kind === "decision") && (!term || `${doc.title}\n${doc.body}`.toLowerCase().includes(term))); }, [docs, search, decisionOnly]);
  // The wiki's shape, over the docs that survived the filter — a matched child
  // whose parent did not still shows, as a root (buildDocTree's rule).
  const tree = useMemo(() => flattenDocTree(buildDocTree(visible)), [visible]);
  const resolvedPreview = useMemo(() => resolveWikiLinks(body, docs), [body, docs]);
  const wanted = useMemo(() => brokenWikiLinks(body, docs), [body, docs]);
  // A doc cannot be moved under itself or anything beneath it — the server's rule,
  // applied here so the illegal option is never offered.
  const parentOptions = useMemo(() => { if (!selected) return []; const barred = descendantIds(docs, selected.id); return docs.filter((doc) => doc.id !== selected.id && !barred.has(doc.id)); }, [docs, selected]);

  /** A resolved [[link]] in the preview selects its target instead of only
   *  jumping to the anchor — the wiki behaviour a reader expects. */
  function followWikiLink(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest("a");
    const id = docIdFromAnchor(anchor?.getAttribute("href"));
    if (id === null) return;
    const target = docs.find((doc) => doc.id === id);
    if (!target) return;
    event.preventDefault();
    choose(target);
  }

  async function reparent(parentId: number | null) { if (!selected) return; setBusy(true); setError(null); try { const doc = await api.updateDoc(selected.id, { parentId }); setDocs((old) => old.map((item) => item.id === doc.id ? doc : item)); setSelected(doc); } catch (e) { setError(e instanceof Error ? e.message : "Could not move document"); } finally { setBusy(false); } }
  /** Creates a wanted page under the doc that asked for it, so a broken link
   *  becomes a real child in one click rather than a note to self. */
  async function createWanted(title: string) { if (!selected) return; setBusy(true); setError(null); try { const doc = await api.createDoc(workspaceId, { title, kind: "page", parentId: selected.id }); setDocs((old) => [...old, doc]); } catch (e) { setError(e instanceof Error ? e.message : "Could not create document"); } finally { setBusy(false); } }

  async function add(kind: DocKind) { setBusy(true); setError(null); try { const doc = await api.createDoc(workspaceId, { ...TEMPLATES[kind], kind }); setDocs((old) => [...old, doc]); choose(doc); } catch (e) { setError(e instanceof Error ? e.message : "Could not create document"); } finally { setBusy(false); } }
  async function save() { if (!selected || !title.trim()) return; setBusy(true); setError(null); try { const doc = await api.updateDoc(selected.id, { title, body }); setDocs((old) => old.map((item) => item.id === doc.id ? doc : item)); choose(doc); } catch (e) { setError(e instanceof Error ? e.message : "Could not save document"); } finally { setBusy(false); } }
  async function togglePublish() { if (!selected) return; setBusy(true); setError(null); try { const doc = await api.updateDoc(selected.id, { isPublished: !selected.isPublished }); setDocs((old) => old.map((item) => item.id === doc.id ? doc : item)); setSelected(doc); } catch (e) { setError(e instanceof Error ? e.message : "Could not update publish state"); } finally { setBusy(false); } }
  async function remove() { if (!selected) return; setBusy(true); try { await api.deleteDoc(selected.id); const next = docs.filter((doc) => doc.id !== selected.id); setDocs(next); choose(next[0] ?? null); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete document"); } finally { setBusy(false); } }
  async function history() { if (!selected) return; try { setRevisions(await api.fetchRevisions(selected.id)); } catch (e) { setError(e instanceof Error ? e.message : "Could not load revision history"); } }
  async function promoteAction() { if (!selected) return; const action = body.match(/^\s*- \[[ xX]\]\s+(.+)$/m)?.[1]; if (!action) { setError("Add an action item like: - [ ] Follow up"); return; } try { const response = await fetch(`/api/docs/${selected.id}/promote-action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: action }) }); if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Could not promote action"); } catch (e) { setError(e instanceof Error ? e.message : "Could not promote action"); } }
  async function extractActions() { if (!selected) return; try { setActions(await api.fetchMeetingActions(selected.id)); } catch (e) { setError(e instanceof Error ? e.message : "Could not extract actions"); } }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-5xl"><DialogHeader><DialogTitle>Docs</DialogTitle><DialogDescription>Workspace pages, meeting notes, decisions, and published knowledge.</DialogDescription></DialogHeader>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="grid min-h-96 grid-cols-[12rem_minmax(0,1fr)] gap-4"><aside className="grid content-start gap-2 border-r pr-3"><div className="flex gap-1"><Input aria-label="Search documents" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" /><Search className="mt-2 size-4 text-muted-foreground" /></div><Button size="sm" variant={decisionOnly?"secondary":"ghost"} onClick={()=>setDecisionOnly(v=>!v)}>Decisions</Button>{canManage && <div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" disabled={busy} onClick={() => void add("page")}><FilePlus2 /> Page</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void add("meeting")}>Meeting</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void add("decision")}>Decision</Button></div>}<div className="grid gap-1 pt-2">{tree.map(({ doc, depth }) => <button key={doc.id} id={`doc-${doc.id}`} type="button" style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }} className={`truncate rounded py-1 pr-2 text-left text-sm ${selected?.id === doc.id ? "bg-muted font-medium" : "hover:bg-muted/60"}`} onClick={() => choose(doc)}>{depth > 0 && <span aria-hidden className="mr-1 text-muted-foreground">└</span>}{doc.title}<span className="ml-1 text-xs text-muted-foreground">{doc.kind}</span>{doc.isPublished && <Globe aria-label="Published" className="ml-1 inline size-3 text-muted-foreground" />}</button>)}</div></aside><section className="grid content-start gap-3">{selected ? <><div className="flex gap-2"><Input aria-label="Document title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canManage} /><Button size="sm" variant="ghost" onClick={() => setPreview((value) => !value)}>{preview ? "Write" : "Preview"}</Button><Button size="sm" variant="ghost" onClick={() => void history()}><History /> History</Button>{canManage && <Button size="sm" variant="ghost" onClick={() => setShareOpen(true)} title="Public links and guest access for this document"><Share2 /> Share</Button>}{canManage && <Button size="sm" variant={selected.isPublished ? "secondary" : "outline"} disabled={busy} onClick={() => void togglePublish()} title={selected.isPublished ? "Published — visible in workspace search and Q&A. Click to unpublish." : "Draft — hidden from search and Q&A. Click to publish."}><Globe /> {selected.isPublished ? "Published" : "Publish"}</Button>}{selected.kind === "meeting" && canManage && <><Button size="sm" variant="ghost" onClick={() => void extractActions()}>Review actions</Button><Button size="sm" variant="ghost" onClick={() => void promoteAction()}>Promote action</Button></>}</div>{canManage && <div className="flex items-center gap-2 text-xs text-muted-foreground"><span>Parent</span><Select value={String(selected.parentId ?? 0)} onValueChange={(value) => void reparent(Number(value) || null)}><SelectItem value="0">No parent (top level)</SelectItem>{parentOptions.map((doc) => <SelectItem key={doc.id} value={String(doc.id)}>{doc.title}</SelectItem>)}</Select></div>}{preview ? <><div onClick={followWikiLink}><RichText text={resolvedPreview} className="min-h-64 rounded border p-3" /></div>{wanted.length > 0 && <p className="text-xs text-muted-foreground">Wanted pages: {wanted.map((name) => <button key={name} type="button" disabled={busy || !canManage} className="mr-2 underline disabled:no-underline" onClick={() => void createWanted(name)}>{name}</button>)}</p>}</> : <CollaborativeEditor key={selected.id} docId={selected.id} initialBody={selected.body} disabled={!canManage} onChange={setBody} />}{actions&&<div className="rounded border p-2 text-xs"><strong>Proposed action items</strong>{actions.length===0?<p className="text-muted-foreground">No unchecked Markdown actions found.</p>:actions.map(a=><p key={a.title}>• {a.title}{a.ownerHint?` · owner: ${a.ownerHint}`:""}{a.dueDate?` · due: ${a.dueDate}`:""}</p>)}</div>}{revisions && <div className="rounded border p-2 text-xs"><strong>History</strong>{revisions.length === 0 ? <p className="text-muted-foreground">No saved revisions yet.</p> : revisions.map((revision) => <p key={revision.id}>{new Date(revision.createdAt).toLocaleString()} — {revision.editedBy}</p>)}</div>}{canManage && <div className="flex justify-between"><Button size="sm" disabled={busy || !title.trim()} onClick={() => void save()}>Save</Button><Button size="sm" variant="ghost" disabled={busy} className="text-destructive" onClick={() => void remove()}>Delete</Button></div>}</> : <EmptyState icon={FileText} title="No page selected" hint="Docs hold workspace pages, meeting notes and decisions. Pages nest under one another and link with [[wiki links]]." />}</section></div>{selected && <ShareDialog open={shareOpen} onOpenChange={setShareOpen} subjectType="doc" subjectId={String(selected.id)} subjectName={selected.title} workspaceId={workspaceId} />}</DialogContent></Dialog>;
}
