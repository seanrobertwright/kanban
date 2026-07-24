import type { CreateDocInput, Doc, DocRevision, MeetingAction, UpdateDocInput } from "../types";

async function jsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function fetchDocs(workspaceId: string, query?: string): Promise<Doc[]> {
  const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
  return fetch(`/api/workspaces/${workspaceId}/docs${suffix}`, { cache: "no-store" }).then(jsonOrThrow<Doc[]>);
}
export function createDoc(workspaceId: string, input: CreateDocInput): Promise<Doc> {
  return fetch(`/api/workspaces/${workspaceId}/docs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then(jsonOrThrow<Doc>);
}
export function updateDoc(id: number, input: UpdateDocInput): Promise<Doc> {
  return fetch(`/api/docs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then(jsonOrThrow<Doc>);
}
export async function deleteDoc(id: number): Promise<void> { const response = await fetch(`/api/docs/${id}`, { method: "DELETE" }); if (!response.ok) throw new Error("Could not delete document"); }
export function fetchRevisions(id: number): Promise<DocRevision[]> { return fetch(`/api/docs/${id}/revisions`, { cache: "no-store" }).then(jsonOrThrow<DocRevision[]>); }
export function fetchMeetingActions(id: number): Promise<MeetingAction[]> { return fetch(`/api/docs/${id}/actions`, { cache: "no-store" }).then(jsonOrThrow<MeetingAction[]>); }
