import type { ShareSubject } from "../types";

export interface PublicLink {
  id: number;
  token: string;
  scope: "read" | "submit";
  expiresAt: string | null;
  createdAt: string;
}

export interface ObjectShare {
  userId: string;
  name: string;
  email: string;
  canEdit: boolean;
  createdAt: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

async function okOrThrow(res: Response): Promise<void> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
}

const subjectQuery = (subjectType: ShareSubject, subjectId: string) =>
  `subjectType=${encodeURIComponent(subjectType)}&subjectId=${encodeURIComponent(subjectId)}`;

export function fetchPublicLinks(
  subjectType: ShareSubject,
  subjectId: string
): Promise<PublicLink[]> {
  return fetch(`/api/public-links?${subjectQuery(subjectType, subjectId)}`, {
    cache: "no-store",
  }).then((res) => jsonOrThrow<PublicLink[]>(res));
}

export function mintPublicLink(
  subjectType: ShareSubject,
  subjectId: string,
  scope: "read" | "submit",
  expiresAt?: string | null
): Promise<{ id: number; token: string }> {
  return fetch(`/api/public-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subjectType, subjectId, scope, expiresAt: expiresAt ?? null }),
  }).then((res) => jsonOrThrow<{ id: number; token: string }>(res));
}

export function revokePublicLink(id: number): Promise<void> {
  return fetch(`/api/public-links/${id}`, { method: "DELETE" }).then(okOrThrow);
}

export function fetchObjectShares(
  subjectType: ShareSubject,
  subjectId: string
): Promise<ObjectShare[]> {
  return fetch(`/api/object-shares?${subjectQuery(subjectType, subjectId)}`, {
    cache: "no-store",
  }).then((res) => jsonOrThrow<ObjectShare[]>(res));
}

export function grantObjectShare(
  subjectType: Exclude<ShareSubject, "view">,
  subjectId: string,
  userId: string,
  canEdit: boolean
): Promise<void> {
  return fetch(`/api/object-shares`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subjectType, subjectId, userId, canEdit }),
  }).then(okOrThrow);
}

export function revokeObjectShare(
  subjectType: Exclude<ShareSubject, "view">,
  subjectId: string,
  userId: string
): Promise<void> {
  return fetch(`/api/object-shares`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subjectType, subjectId, userId }),
  }).then(okOrThrow);
}

/** The guest-visible board behind an object share (GET /api/board/[id]/shared). */
export function fetchSharedBoard(boardId: number): Promise<{
  id: number;
  name: string;
  columns: { id: number; title: string; position: number }[];
  tasks: { id: number; columnId: number; title: string; description: string }[];
  canEdit: boolean;
}> {
  return fetch(`/api/board/${boardId}/shared`, { cache: "no-store" }).then((res) =>
    jsonOrThrow(res)
  );
}
