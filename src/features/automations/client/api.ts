import type {
  AutomationRule,
  AutomationRun,
  CreateAutomationRuleInput,
  UpdateAutomationRuleInput,
} from "../types";

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

export async function fetchAutomations(
  boardId: number
): Promise<AutomationRule[]> {
  const res = await fetch(`/api/board/${boardId}/automations`, {
    cache: "no-store",
  });
  return jsonOrThrow<AutomationRule[]>(res);
}

export function createAutomation(
  boardId: number,
  input: CreateAutomationRuleInput
): Promise<AutomationRule> {
  return fetch(`/api/board/${boardId}/automations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<AutomationRule>(res));
}

export function updateAutomation(
  id: number,
  input: UpdateAutomationRuleInput
): Promise<AutomationRule> {
  return fetch(`/api/automations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => jsonOrThrow<AutomationRule>(res));
}

export async function deleteAutomation(id: number): Promise<void> {
  const res = await fetch(`/api/automations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

export async function fetchAutomationRuns(
  id: number
): Promise<AutomationRun[]> {
  const res = await fetch(`/api/automations/${id}/runs`, { cache: "no-store" });
  return jsonOrThrow<AutomationRun[]>(res);
}
