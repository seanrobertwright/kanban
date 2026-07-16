import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { getBoard } from "@/features/board/server/repository";
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
