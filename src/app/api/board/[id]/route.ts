import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import {
  getBoard,
  setBoardDoneColumn,
} from "@/features/board/server/repository";
import { authzErrorResponse } from "@/features/workspaces/server/authz";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  const { id } = await params;
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) {
    return Response.json({ error: "Invalid board id" }, { status: 400 });
  }

  try {
    const board = await getBoard(principal, boardId);
    return board
      ? Response.json(board)
      : Response.json({ error: "Board not found" }, { status: 404 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/**
 * Sets or clears the board's done column (020). Inline like GET — the board has
 * no handlers.ts, and this is one narrow write. `columnId: number | null`, where
 * null unsets the designation; the repository proves the column is this board's.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  const { id } = await params;
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) {
    return Response.json({ error: "Invalid board id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { doneColumnId } = body as Record<string, unknown>;
  if (doneColumnId !== null && !Number.isInteger(doneColumnId)) {
    return Response.json(
      { error: "doneColumnId must be a column id or null" },
      { status: 400 }
    );
  }

  try {
    await setBoardDoneColumn(principal, boardId, doneColumnId as number | null);
    return new Response(null, { status: 204 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
