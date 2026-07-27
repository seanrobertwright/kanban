import type { CreateAutomationRuleInput, TriggerEvent } from "../types";

/**
 * The phrasebook: a constrained-language drafter that recognises a handful of
 * sentences exactly and refuses everything else rather than guessing.
 *
 * Since 4.4 this is the *fallback*, not the builder — `server/draft.ts` asks a
 * model first and falls here when none is configured (or when the call fails),
 * the same honest-degradation shape knowledge (4.3) uses. It stays pure and
 * client-safe: no ids beyond the columns it is handed, no network.
 */
export function draftAutomation(prompt: string, columns: { id:number; title:string }[]): CreateAutomationRuleInput | null {
  const text = prompt.trim(); const lower = text.toLowerCase();
  const event: TriggerEvent | undefined = lower.includes("pr merges") || lower.includes("pull request merges") ? "git.pr_merged" : lower.includes("ci fails") ? "git.ci_failed" : lower.includes("task is moved") || lower.includes("task moves") ? "task.moved" : lower.includes("task is created") ? "task.created" : undefined;
  if (!event) return null;
  const moveName = text.match(/move(?: it| task)? to ([\w -]+)/i)?.[1]?.trim().toLowerCase();
  const column = moveName ? columns.find(c => c.title.toLowerCase() === moveName) : undefined;
  const comment = text.match(/comment(?: saying)?[ :]+["']?(.+?)["']?$/i)?.[1]?.trim();
  const actions = [column ? { type:"move" as const, columnId:column.id } : null, comment ? {type:"comment" as const, body:comment} : null].filter(Boolean) as CreateAutomationRuleInput["actions"];
  if (!actions?.length) return null;
  return { name: `Draft: ${text.slice(0,60)}`, trigger:{event}, conditions:{all:[]}, actions, isEnabled:false };
}
