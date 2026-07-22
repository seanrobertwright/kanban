import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  EFFORT_MAX,
  FEEDBACK_BODY_MAX,
  FEEDBACK_SOURCE_MAX,
  IDEA_TITLE_MAX,
  REACH_MAX,
  isFeedbackSentiment,
  isIdeaStatus,
  type CreateFeedbackInput,
  type CreateIdeaInput,
  type UpdateFeedbackInput,
  type UpdateIdeaInput,
} from "../types";
import {
  createFeedback,
  createIdea,
  deleteFeedback,
  deleteIdea,
  getBoardDiscovery,
  promoteIdea,
  PromoteError,
  updateFeedback,
  updateIdea,
} from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function notFound(what: string) {
  return Response.json({ error: `${what} not found` }, { status: 404 });
}

/** An integer RICE input in [min, max], or the sentinel `false` on a bad value.
 *  Absent (`undefined`) passes through so a partial update leaves the field. */
function readInt(
  v: unknown,
  min: number,
  max: number
): number | undefined | false {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    return false;
  return v;
}

/** Pulls the four RICE inputs off a payload; a bad one short-circuits to a message. */
function readRice(
  p: Record<string, unknown>
): { reach?: number; impact?: number; confidence?: number; effort?: number } | { error: string } {
  const reach = readInt(p.reach, 0, REACH_MAX);
  if (reach === false) return { error: `reach must be an integer 0..${REACH_MAX}` };
  const impact = readInt(p.impact, 1, 5);
  if (impact === false) return { error: "impact must be an integer 1..5" };
  const confidence = readInt(p.confidence, 0, 100);
  if (confidence === false) return { error: "confidence must be an integer 0..100" };
  const effort = readInt(p.effort, 1, EFFORT_MAX);
  if (effort === false) return { error: `effort must be an integer 1..${EFFORT_MAX}` };
  return { reach, impact, confidence, effort };
}

export async function handleListDiscovery(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json(await getBoardDiscovery(principal, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateIdea(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;

  if (typeof p.title !== "string" || p.title.trim() === "")
    return badRequest("title is required");
  if (p.title.trim().length > IDEA_TITLE_MAX)
    return badRequest(`title must be ${IDEA_TITLE_MAX} characters or fewer`);
  if (p.description !== undefined && typeof p.description !== "string")
    return badRequest("description must be a string");
  const rice = readRice(p);
  if ("error" in rice) return badRequest(rice.error);

  const input: CreateIdeaInput = {
    title: p.title.trim(),
    description: p.description as string | undefined,
    ...rice,
  };
  try {
    return Response.json(await createIdea(session.user.id, boardId, input), {
      status: 201,
    });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateIdea(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const ideaId = Number(id);
  if (!Number.isInteger(ideaId)) return badRequest("Invalid idea id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;

  const input: UpdateIdeaInput = {};
  if (p.title !== undefined) {
    if (typeof p.title !== "string" || p.title.trim() === "")
      return badRequest("title must be a non-empty string");
    if (p.title.trim().length > IDEA_TITLE_MAX)
      return badRequest(`title must be ${IDEA_TITLE_MAX} characters or fewer`);
    input.title = p.title.trim();
  }
  if (p.description !== undefined) {
    if (typeof p.description !== "string") return badRequest("description must be a string");
    input.description = p.description;
  }
  if (p.status !== undefined) {
    if (!isIdeaStatus(p.status))
      return badRequest("status must be exploring, validating, validated, promoted, or archived");
    input.status = p.status;
  }
  const rice = readRice(p);
  if ("error" in rice) return badRequest(rice.error);
  if (rice.reach !== undefined) input.reach = rice.reach;
  if (rice.impact !== undefined) input.impact = rice.impact;
  if (rice.confidence !== undefined) input.confidence = rice.confidence;
  if (rice.effort !== undefined) input.effort = rice.effort;

  try {
    const idea = await updateIdea(session.user.id, ideaId, input);
    return idea ? Response.json(idea) : notFound("Idea");
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteIdea(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const ideaId = Number(id);
  if (!Number.isInteger(ideaId)) return badRequest("Invalid idea id");
  try {
    return (await deleteIdea(session.user.id, ideaId))
      ? new Response(null, { status: 204 })
      : notFound("Idea");
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handlePromoteIdea(request: Request, id: string) {
  // Member (a task creation), but an agent reasoning over discovery may promote
  // too — a principal, like a form submission.
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const ideaId = Number(id);
  if (!Number.isInteger(ideaId)) return badRequest("Invalid idea id");
  try {
    return Response.json(await promoteIdea(principal, ideaId), { status: 201 });
  } catch (error) {
    if (error instanceof PromoteError) return badRequest(error.message);
    return authzErrorResponse(error);
  }
}

export async function handleCreateFeedback(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;

  if (typeof p.body !== "string" || p.body.trim() === "")
    return badRequest("body is required");
  if (p.body.trim().length > FEEDBACK_BODY_MAX)
    return badRequest(`body must be ${FEEDBACK_BODY_MAX} characters or fewer`);
  if (p.source !== undefined && typeof p.source !== "string")
    return badRequest("source must be a string");
  if (typeof p.source === "string" && p.source.trim().length > FEEDBACK_SOURCE_MAX)
    return badRequest(`source must be ${FEEDBACK_SOURCE_MAX} characters or fewer`);
  if (p.sentiment !== undefined && !isFeedbackSentiment(p.sentiment))
    return badRequest("sentiment must be praise, problem, idea, or question");
  if (p.ideaId !== undefined && p.ideaId !== null && !Number.isInteger(p.ideaId))
    return badRequest("ideaId must be an idea id or null");

  const input: CreateFeedbackInput = {
    body: p.body.trim(),
    source: p.source as string | undefined,
    sentiment: isFeedbackSentiment(p.sentiment) ? p.sentiment : undefined,
    ideaId: (p.ideaId as number | null | undefined) ?? undefined,
  };
  try {
    return Response.json(await createFeedback(session.user.id, boardId, input), {
      status: 201,
    });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateFeedback(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const feedbackId = Number(id);
  if (!Number.isInteger(feedbackId)) return badRequest("Invalid feedback id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;

  const input: UpdateFeedbackInput = {};
  if ("ideaId" in p) {
    if (p.ideaId !== null && !Number.isInteger(p.ideaId))
      return badRequest("ideaId must be an idea id or null");
    input.ideaId = p.ideaId as number | null;
  }
  if (p.vote !== undefined) {
    if (typeof p.vote !== "boolean") return badRequest("vote must be a boolean");
    input.vote = p.vote;
  }

  try {
    const feedback = await updateFeedback(session.user.id, feedbackId, input);
    return feedback ? Response.json(feedback) : notFound("Feedback");
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteFeedback(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const feedbackId = Number(id);
  if (!Number.isInteger(feedbackId)) return badRequest("Invalid feedback id");
  try {
    return (await deleteFeedback(session.user.id, feedbackId))
      ? new Response(null, { status: 204 })
      : notFound("Feedback");
  } catch (error) {
    return authzErrorResponse(error);
  }
}
