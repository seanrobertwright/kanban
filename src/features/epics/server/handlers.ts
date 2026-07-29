import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { principalActor } from "@/features/auth/server/principal";
import { externalAgentAction } from "@/features/agents/server/gate";
import { door2Response } from "@/features/agents/server/door2";
import {
  authzErrorResponse,
  requireBoardRole,
} from "@/features/workspaces/server/authz";
import {
  EPIC_STATUSES,
  isEpicStatus,
  type EpicStatus,
  type UpdateEpicInput,
} from "../types";
import {
  assertOwnerAssignable,
  createEpic,
  deleteEpic,
  listEpics,
  requireEpic,
  updateEpic,
} from "./repository";

// Reads take a principal (an agent that can read a board can read its
// groupings). Create and edit now take one too and put an agent through §7.4's
// gate (externalAgentAction), which is what makes Door 2's set_epic obey the
// same approval policy the native runtime's does — PRD §7.1's "same policy,
// both doors", and the reason the objectives handlers took this shape first.
//
// Deletion stays session-only, milestone's split: it is the one epic verb with
// no agent tool behind it, on either door.

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound() {
  return Response.json({ error: "Epic not found" }, { status: 404 });
}

export async function handleListEpics(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json(await listEpics(principal, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateEpic(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");
  const { name, status, ownerId } = payload as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "")
    return badRequest("name is required");
  if (status !== undefined && !isEpicStatus(status))
    return badRequest(`status must be one of ${EPIC_STATUSES.join(", ")}`);
  if (ownerId !== undefined && ownerId !== null && typeof ownerId !== "string")
    return badRequest("ownerId must be a user id or null");

  const input = {
    name: name.trim(),
    status: status as EpicStatus | undefined,
    ownerId: ownerId as string | null | undefined,
  };

  try {
    if (principal.kind === "agent") {
      const outcome = await externalAgentAction(principal, {
        tool: "set_epic",
        // The recorded input is exactly what applyProposed hands back to
        // createEpic, boardId included — a proposal a reviewer accepts has to be
        // able to run without the request that made it (set_objective's rule).
        input: { boardId, ...input },
        taskId: null,
        // Checked before a proposal is minted, so an agent that cannot write
        // this board — or has named an owner it cannot see — is refused now
        // rather than filling a reviewer's queue with something that will throw
        // on accept and abandon the rest of the batch with it.
        authorize: async () => {
          const { workspaceId } = await requireBoardRole(
            principal,
            boardId,
            "member"
          );
          if (input.ownerId != null)
            await assertOwnerAssignable(workspaceId, input.ownerId);
        },
        execute: () =>
          createEpic(principal, boardId, input, principalActor(principal)),
      });
      const refusal = door2Response(outcome);
      if (refusal) return refusal;
      return Response.json((outcome as { kind: "done"; result: unknown }).result, {
        status: 201,
      });
    }

    const epic = await createEpic(
      principal,
      boardId,
      input,
      principalActor(principal)
    );
    return Response.json(epic, { status: 201 });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateEpic(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const epicId = Number(id);
  if (!Number.isInteger(epicId)) return badRequest("Invalid epic id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return badRequest("Invalid JSON body");
  const { name, status, ownerId } = payload as Record<string, unknown>;
  if (name !== undefined && (typeof name !== "string" || name.trim() === ""))
    return badRequest("name must be a non-empty string");
  if (status !== undefined && !isEpicStatus(status))
    return badRequest(`status must be one of ${EPIC_STATUSES.join(", ")}`);
  // Three-valued on the wire as well as in the repository: absent leaves the
  // owner, an explicit null clears it. `"ownerId" in payload` is what tells them
  // apart — JSON.stringify drops undefined, so a client that means "leave it"
  // simply omits the key.
  if (ownerId !== undefined && ownerId !== null && typeof ownerId !== "string")
    return badRequest("ownerId must be a user id or null");

  const input: UpdateEpicInput = {
    name: typeof name === "string" ? name.trim() : undefined,
    status: status as EpicStatus | undefined,
  };
  // The spread is the three-valued rule made real: a key that exists only when
  // the caller sent one, so a status-only edit cannot silently un-own the epic.
  if ("ownerId" in (payload as Record<string, unknown>))
    input.ownerId = ownerId as string | null;

  try {
    if (principal.kind === "agent") {
      const outcome = await externalAgentAction(principal, {
        tool: "set_epic",
        input: { id: epicId, ...input },
        taskId: null,
        authorize: async () => {
          const { workspaceId } = await requireEpic(principal, epicId);
          if (input.ownerId != null)
            await assertOwnerAssignable(workspaceId, input.ownerId);
        },
        execute: () =>
          updateEpic(principal, epicId, input, principalActor(principal)),
      });
      const refusal = door2Response(outcome);
      if (refusal) return refusal;
      const epic = (outcome as { kind: "done"; result: unknown }).result;
      return epic ? Response.json(epic) : notFound();
    }

    const epic = await updateEpic(
      principal,
      epicId,
      input,
      principalActor(principal)
    );
    return epic ? Response.json(epic) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteEpic(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const epicId = Number(id);
  if (!Number.isInteger(epicId)) return badRequest("Invalid epic id");

  try {
    return (await deleteEpic(session.user.id, epicId, {
      type: "human",
      id: session.user.id,
    }))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}
