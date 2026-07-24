"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { TaskIntegrationLink } from "../server/google";

async function unwrap<T>(response: Response | Promise<Response>): Promise<T> { const resolved = await response; const body = await resolved.json().catch(() => null); if (!resolved.ok) throw new Error(body?.error ?? `Request failed (${resolved.status})`); return body as T; }

/** Third-party links remain remote references, never copied attachment bytes.
 * The section is intentionally task-local: members can connect only data they
 * already have access to through the workspace and the provider OAuth grant. */
export function TaskIntegrationsSection({ taskId }: { taskId: number }) {
  const [links, setLinks] = useState<TaskIntegrationLink[]>([]); const [googleUrl, setGoogleUrl] = useState(""); const [microsoftUrl, setMicrosoftUrl] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const load = async () => setLinks(await unwrap<TaskIntegrationLink[]>(await fetch(`/api/tasks/${taskId}/integrations`, { cache: "no-store" })));
  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load integrations")); }, [taskId]);
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(null); try { await action(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Integration action failed"); } finally { setBusy(false); } }
  const post = (path: string, body?: unknown) => unwrap(fetch(`/api/tasks/${taskId}/integrations/${path}`, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }));
  return <section className="grid gap-2"><p className="text-xs font-medium text-muted-foreground">Connected work</p><div className="grid gap-2 rounded-md border p-2"><div className="flex flex-wrap gap-2"><Input aria-label="Google Drive URL" value={googleUrl} onChange={(e) => setGoogleUrl(e.target.value)} placeholder="Google Drive file URL" className="h-8 flex-1" /><Button size="sm" disabled={busy || !googleUrl.trim()} onClick={() => void run(async () => { await post("google/drive", { url: googleUrl }); setGoogleUrl(""); })}>Link Google Drive</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => post("google/calendar"))}>Sync Google Calendar</Button></div><div className="flex flex-wrap gap-2"><Input aria-label="OneDrive or SharePoint URL" value={microsoftUrl} onChange={(e) => setMicrosoftUrl(e.target.value)} placeholder="OneDrive or SharePoint file URL" className="h-8 flex-1" /><Button size="sm" disabled={busy || !microsoftUrl.trim()} onClick={() => void run(async () => { await post("microsoft/drive", { url: microsoftUrl }); setMicrosoftUrl(""); })}>Link Microsoft file</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => post("microsoft/calendar"))}>Sync Outlook Calendar</Button></div>{links.map((link) => <a key={link.id} className="flex items-center gap-1 text-xs text-primary underline" href={link.url} target="_blank" rel="noreferrer"><ExternalLink className="size-3" />{link.provider}: {link.name}</a>)}{error && <p className="text-xs text-destructive" role="alert">{error}</p>}</div></section>;
}
