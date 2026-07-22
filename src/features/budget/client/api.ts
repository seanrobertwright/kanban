import type { BoardBudget, SetBoardBudgetInput } from "../types";

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

export async function fetchBudget(boardId: number): Promise<BoardBudget> {
  const res = await fetch(`/api/board/${boardId}/budget`, { cache: "no-store" });
  return jsonOrThrow<BoardBudget>(res);
}

export function setBudget(
  boardId: number,
  input: SetBoardBudgetInput
): Promise<BoardBudget> {
  return fetch(`/api/board/${boardId}/budget`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<BoardBudget>(res));
}
