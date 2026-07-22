import type { Task } from "@/features/tasks/types";
import type {
  CreateFeedbackInput,
  CreateIdeaInput,
  DiscoveryOverview,
  Feedback,
  Idea,
  UpdateFeedbackInput,
  UpdateIdeaInput,
} from "../types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ??
        `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

export function fetchDiscovery(boardId: number): Promise<DiscoveryOverview> {
  return fetch(`/api/board/${boardId}/discovery`, { cache: "no-store" }).then(
    (res) => jsonOrThrow<DiscoveryOverview>(res)
  );
}

export function createIdea(
  boardId: number,
  input: CreateIdeaInput
): Promise<Idea> {
  return fetch(`/api/board/${boardId}/discovery/ideas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Idea>(res));
}

export function updateIdea(id: number, input: UpdateIdeaInput): Promise<Idea> {
  return fetch(`/api/discovery/ideas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Idea>(res));
}

export async function deleteIdea(id: number): Promise<void> {
  const res = await fetch(`/api/discovery/ideas/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

export function promoteIdea(id: number): Promise<Task> {
  return fetch(`/api/discovery/ideas/${id}/promote`, { method: "POST" }).then(
    (res) => jsonOrThrow<Task>(res)
  );
}

export function createFeedback(
  boardId: number,
  input: CreateFeedbackInput
): Promise<Feedback> {
  return fetch(`/api/board/${boardId}/discovery/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Feedback>(res));
}

export function updateFeedback(
  id: number,
  input: UpdateFeedbackInput
): Promise<Feedback> {
  return fetch(`/api/discovery/feedback/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<Feedback>(res));
}

export async function deleteFeedback(id: number): Promise<void> {
  const res = await fetch(`/api/discovery/feedback/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
