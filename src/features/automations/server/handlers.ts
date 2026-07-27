import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import {
  AUTOMATION_NAME_MAX,
  type Action,
  type Condition,
  type CreateAutomationRuleInput,
  type UpdateAutomationRuleInput,
} from "../types";
import { readActions, readCondition, readTrigger } from "./validate";
import { draftAutomationForBoard } from "./draft";
import {
  boardForTriggerToken,
  createAutomationRule,
  createTrigger,
  deleteAutomationRule,
  deleteTrigger,
  listAutomationRuns,
  listAutomationRules,
  listTriggers,
  setTriggerActive,
  updateAutomationRule,
} from "./repository";
import { fireExternalTrigger } from "./scheduler";
import {
  applyWorkflowTemplate,
  createWorkflowTemplate,
  deleteWorkflowTemplate,
  listWorkflowTemplates,
} from "./workflow-templates";
import {
  getBoardWorkflow,
  setBoardWorkflow,
} from "@/features/board/server/repository";
import type { BoardWorkflow } from "../types";

// Reads take a principal (an agent that can read a board can read its rules);
// authoring takes a session and the repository gates it to admin.

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}
function notFound(what = "Automation") {
  return Response.json({ error: `${what} not found` }, { status: 404 });
}

export async function handleListAutomations(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json(await listAutomationRules(principal, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateAutomation(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;

  if (typeof p.name !== "string" || p.name.trim() === "")
    return badRequest("name is required");
  if (p.name.trim().length > AUTOMATION_NAME_MAX)
    return badRequest(`name must be ${AUTOMATION_NAME_MAX} characters or fewer`);
  const trigger = readTrigger(p.trigger);
  if ("error" in trigger) return badRequest(trigger.error);
  const conditions = p.conditions === undefined ? undefined : readCondition(p.conditions);
  if (conditions && "error" in conditions) return badRequest(conditions.error);
  const actions = p.actions === undefined ? undefined : readActions(p.actions);
  if (actions && "error" in actions) return badRequest(actions.error);
  if (p.isEnabled !== undefined && typeof p.isEnabled !== "boolean")
    return badRequest("isEnabled must be a boolean");

  const input: CreateAutomationRuleInput = {
    name: p.name.trim(),
    trigger,
    conditions: conditions as Condition | undefined,
    actions: actions as Action[] | undefined,
    isEnabled: p.isEnabled as boolean | undefined,
  };
  try {
    return Response.json(await createAutomationRule(session.user.id, boardId, input), {
      status: 201,
    });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/**
 * The AI workflow builder's door (4.4). It returns a *draft* — a validated,
 * disabled `CreateAutomationRuleInput` — and never writes: enabling is the
 * admin's own POST through handleCreateAutomation, which validates the body
 * again. A draft the engine cannot express comes back 400 with the reason,
 * rather than a coerced rule that does something adjacent.
 */
export async function handleDraftAutomation(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const payload = await request.json().catch(() => null);
  const prompt = (payload as Record<string, unknown> | null)?.prompt;
  if (typeof prompt !== "string") return badRequest("prompt is required");

  try {
    const draft = await draftAutomationForBoard(session.user.id, boardId, prompt);
    return "error" in draft ? badRequest(draft.error) : Response.json(draft);
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateAutomation(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const ruleId = Number(id);
  if (!Number.isInteger(ruleId)) return badRequest("Invalid automation id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;

  const input: UpdateAutomationRuleInput = {};
  if (p.name !== undefined) {
    if (typeof p.name !== "string" || p.name.trim() === "")
      return badRequest("name must be a non-empty string");
    if (p.name.trim().length > AUTOMATION_NAME_MAX)
      return badRequest(`name must be ${AUTOMATION_NAME_MAX} characters or fewer`);
    input.name = p.name.trim();
  }
  if (p.trigger !== undefined) {
    const trigger = readTrigger(p.trigger);
    if ("error" in trigger) return badRequest(trigger.error);
    input.trigger = trigger;
  }
  if (p.conditions !== undefined) {
    const conditions = readCondition(p.conditions);
    if ("error" in conditions) return badRequest(conditions.error);
    input.conditions = conditions as Condition;
  }
  if (p.actions !== undefined) {
    const actions = readActions(p.actions);
    if ("error" in actions) return badRequest(actions.error);
    input.actions = actions;
  }
  if (p.isEnabled !== undefined) {
    if (typeof p.isEnabled !== "boolean") return badRequest("isEnabled must be a boolean");
    input.isEnabled = p.isEnabled;
  }

  try {
    const rule = await updateAutomationRule(session.user.id, ruleId, input);
    return rule ? Response.json(rule) : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteAutomation(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const ruleId = Number(id);
  if (!Number.isInteger(ruleId)) return badRequest("Invalid automation id");
  try {
    return (await deleteAutomationRule(session.user.id, ruleId))
      ? new Response(null, { status: 204 })
      : notFound();
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/** Validates the transition map: allowed is {colId: [colId]}, guards optional. */
function readWorkflow(v: unknown): BoardWorkflow | null | { error: string } {
  if (v === null) return null;
  if (!v || typeof v !== "object") return { error: "workflow must be an object or null" };
  const o = v as Record<string, unknown>;
  if (!o.allowed || typeof o.allowed !== "object")
    return { error: "workflow.allowed must be an object" };
  const allowed: Record<string, number[]> = {};
  for (const [from, tos] of Object.entries(o.allowed as Record<string, unknown>)) {
    if (!/^\d+$/.test(from)) return { error: "allowed keys must be column ids" };
    if (!Array.isArray(tos) || tos.some((t) => !Number.isInteger(t)))
      return { error: "each allowed entry must be an array of column ids" };
    allowed[from] = tos as number[];
  }
  const workflow: BoardWorkflow = { allowed };
  if (o.guards !== undefined) {
    if (!o.guards || typeof o.guards !== "object")
      return { error: "workflow.guards must be an object" };
    const guards: Record<string, import("../types").Condition> = {};
    for (const [edge, cond] of Object.entries(o.guards as Record<string, unknown>)) {
      const c = readCondition(cond);
      if ("error" in c) return { error: `guard ${edge}: ${c.error}` };
      guards[edge] = c;
    }
    workflow.guards = guards;
  }
  return workflow;
}

export async function handleGetWorkflow(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json({ workflow: await getBoardWorkflow(principal, boardId) });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleSetWorkflow(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const workflow = readWorkflow((payload as Record<string, unknown>).workflow);
  if (workflow && "error" in workflow) return badRequest(workflow.error);
  try {
    await setBoardWorkflow(session.user.id, boardId, workflow);
    return Response.json({ workflow });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleListAutomationRuns(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const ruleId = Number(id);
  if (!Number.isInteger(ruleId)) return badRequest("Invalid automation id");
  try {
    return Response.json(await listAutomationRuns(principal, ruleId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

// ─── inbound trigger tokens (1.12) ───

export async function handleListTriggers(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json(await listTriggers(session.user.id, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateTrigger(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  const payload = await request.json().catch(() => ({}));
  const name = typeof (payload as Record<string, unknown>)?.name === "string"
    ? ((payload as Record<string, unknown>).name as string)
    : "";
  try {
    return Response.json(await createTrigger(session.user.id, boardId, name), {
      status: 201,
    });
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleUpdateTrigger(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const triggerId = Number(id);
  if (!Number.isInteger(triggerId)) return badRequest("Invalid trigger id");
  const payload = await request.json().catch(() => null);
  const isActive = (payload as Record<string, unknown> | null)?.isActive;
  if (typeof isActive !== "boolean") return badRequest("isActive must be a boolean");
  try {
    return (await setTriggerActive(session.user.id, triggerId, isActive))
      ? Response.json({ ok: true })
      : notFound("Trigger");
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteTrigger(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const triggerId = Number(id);
  if (!Number.isInteger(triggerId)) return badRequest("Invalid trigger id");
  try {
    return (await deleteTrigger(session.user.id, triggerId))
      ? new Response(null, { status: 204 })
      : notFound("Trigger");
  } catch (error) {
    return authzErrorResponse(error);
  }
}

// ─── workflow templates (1.9) ───

export async function handleListWorkflowTemplates(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  try {
    return Response.json(await listWorkflowTemplates(principal, id));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleCreateWorkflowTemplate(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const p = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p || typeof p.name !== "string" || p.name.trim() === "")
    return badRequest("name is required");
  try {
    return Response.json(
      await createWorkflowTemplate(session.user.id, id, {
        name: p.name.trim(),
        description: p.description as string | undefined,
        columns: p.columns as string[] | undefined,
        rules: p.rules as import("../types").WorkflowTemplateRule[] | undefined,
        slaPolicies: p.slaPolicies as import("../types").WorkflowTemplateSla[] | undefined,
      }),
      { status: 201 }
    );
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleDeleteWorkflowTemplate(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const templateId = Number(id);
  if (!Number.isInteger(templateId)) return badRequest("Invalid template id");
  try {
    return (await deleteWorkflowTemplate(session.user.id, templateId))
      ? new Response(null, { status: 204 })
      : notFound("Template");
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleApplyTemplate(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  const p = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const ref = p?.templateRef;
  if (typeof ref !== "string" || ref === "") return badRequest("templateRef is required");
  try {
    return Response.json(await applyWorkflowTemplate(session.user.id, boardId, ref));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

/**
 * The inbound fire (1.12) — no session, the token is the credential. An external
 * tool POSTs here to drive the board's external.trigger rules. A bad or inactive
 * token is a flat 404 (anti-enumeration, the not_found discipline), not a hint
 * that the board or token half-exists.
 */
export async function handleFireTrigger(
  _request: Request,
  id: string,
  token: string
) {
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return notFound("Trigger");
  const resolved = await boardForTriggerToken(boardId, token);
  if (resolved === null) return notFound("Trigger");
  const fired = await fireExternalTrigger(resolved);
  return Response.json({ fired });
}
