import type { BoardData } from "../types";

export async function fetchBoard(boardId: number): Promise<BoardData> {
  const res = await fetch(`/api/board/${boardId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load board (${res.status})`);
  return res.json();
}
