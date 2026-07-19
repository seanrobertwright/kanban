import type { BoardData, Column } from "../types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

export async function fetchBoard(boardId: number): Promise<BoardData> {
  const res = await fetch(`/api/board/${boardId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load board (${res.status})`);
  return res.json();
}

/**
 * Set or clear the board's done column (020) — null unsets it. Surfaces the
 * server's sentence on refusal (a non-admin, or a column not on this board).
 */
export async function setDoneColumn(
  boardId: number,
  doneColumnId: number | null
): Promise<void> {
  const res = await fetch(`/api/board/${boardId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doneColumnId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    );
  }
}

export function createColumn(boardId: number, title: string): Promise<Column> {
  return fetch(`/api/board/${boardId}/columns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  }).then((res) => jsonOrThrow<Column>(res));
}

export function renameColumn(id: number, title: string): Promise<Column> {
  return fetch(`/api/columns/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  }).then((res) => jsonOrThrow<Column>(res));
}

/** Set or clear (null) a column's WIP limit (023). */
export function setColumnWipLimit(
  id: number,
  wipLimit: number | null
): Promise<Column> {
  return fetch(`/api/columns/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wipLimit }),
  }).then((res) => jsonOrThrow<Column>(res));
}

export async function moveColumn(id: number, position: number): Promise<void> {
  const res = await fetch(`/api/columns/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ position }),
  });
  if (!res.ok) throw new Error(`Move failed (${res.status})`);
}

/**
 * Surfaces the server's message rather than a status code, because the one
 * failure a user will actually hit here is the 409 — "this column still holds N
 * tasks" — and that sentence is the whole point of the refusal.
 */
export async function deleteColumn(id: number): Promise<void> {
  const res = await fetch(`/api/columns/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Delete failed (${res.status})`
    );
  }
}
