import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import {
  getSessionFromRequest,
  unauthorized,
} from "@/features/auth/server/session";
import { authzErrorResponse } from "@/features/workspaces/server/authz";
import { CURRENCY_MAX, MONEY_MAX, type SetBoardBudgetInput } from "../types";
import { getBoardBudget, setBoardBudget } from "./repository";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/** A finite, in-range money value, or the sentinel `false`. */
function readMoney(v: unknown): number | false {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MONEY_MAX
    ? v
    : false;
}

export async function handleGetBudget(request: Request, id: string) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");
  try {
    return Response.json(await getBoardBudget(principal, boardId));
  } catch (error) {
    return authzErrorResponse(error);
  }
}

export async function handleSetBudget(request: Request, id: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return badRequest("Invalid board id");

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return badRequest("Invalid JSON body");
  const p = payload as Record<string, unknown>;

  const input: SetBoardBudgetInput = {};
  if ("budgetAmount" in p) {
    if (p.budgetAmount === null) {
      input.budgetAmount = null;
    } else {
      const amount = readMoney(p.budgetAmount);
      if (amount === false) return badRequest("budgetAmount must be a non-negative number or null");
      input.budgetAmount = amount;
    }
  }
  if (p.hourlyRate !== undefined) {
    const rate = readMoney(p.hourlyRate);
    if (rate === false) return badRequest("hourlyRate must be a non-negative number");
    input.hourlyRate = rate;
  }
  if (p.currency !== undefined) {
    if (typeof p.currency !== "string" || p.currency.trim() === "")
      return badRequest("currency must be a non-empty string");
    if (p.currency.trim().length > CURRENCY_MAX)
      return badRequest(`currency must be ${CURRENCY_MAX} characters or fewer`);
    input.currency = p.currency;
  }

  try {
    return Response.json(await setBoardBudget(session.user.id, boardId, input));
  } catch (error) {
    return authzErrorResponse(error);
  }
}
