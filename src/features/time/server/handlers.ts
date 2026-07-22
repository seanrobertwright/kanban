import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { addTimeEntry, deleteTimeEntry, listTaskTime } from "./repository";
import { getBoardTimesheet } from "./timesheet";

// Reads take a principal (an agent reasoning about a task may read its
// hours); writes take a session — minutes are a human's ledger, an agent's
// spend is the run's cost telemetry.

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleListTaskTime(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const taskId = Number(id);
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");
  try {
    return Response.json(await listTaskTime(principal, taskId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleBoardTimesheet(request: Request, id: string) {
  // A read (viewer+), so a principal — an agent reasoning about a board may read
  // its hours, listTaskTime's rule one level up. from/to ride the query string.
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const url = new URL(request.url);
  try {
    return Response.json(
      await getBoardTimesheet(principal, boardId, {
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
      })
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleAddTimeEntry(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const taskId = Number(id);
  if (!Number.isInteger(taskId)) return badRequest("Invalid task id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");
  const { minutes, spentOn, note } = payload as Record<string, unknown>;
  if (!Number.isInteger(minutes) || (minutes as number) <= 0)
    return badRequest("minutes must be a positive integer");
  if (
    spentOn !== undefined &&
    spentOn !== null &&
    (typeof spentOn !== "string" || !ISO_DATE.test(spentOn))
  )
    return badRequest("spentOn must be a YYYY-MM-DD date");
  if (note !== undefined && typeof note !== "string")
    return badRequest("note must be a string");

  try {
    const entry = await addTimeEntry(session.user.id, taskId, {
      minutes: minutes as number,
      spentOn: (spentOn as string | null) ?? null,
      note: note as string | undefined,
    });
    return Response.json(entry, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteTimeEntry(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const entryId = Number(id);
  if (!Number.isInteger(entryId)) return badRequest("Invalid time entry id");
  try {
    return (await deleteTimeEntry(session.user.id, entryId))
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Time entry not found" }, { status: 404 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
