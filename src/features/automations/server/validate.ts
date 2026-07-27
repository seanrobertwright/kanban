/**
 * The rule-shape validators, extracted from `handlers.ts` so more than one door
 * can reach them. The API handler is one caller; the AI drafter (rock 4.4,
 * `draft.ts`) is the other — a model-proposed rule is validated by *this* code,
 * the same predicate the POST body walks, rather than by a second, laxer copy
 * that would let a draft describe a rule the API would refuse.
 *
 * Each reader returns the narrowed value or `{ error }` — never throws, never
 * coerces. A caller that gets an error reports it; nothing is repaired silently.
 */

import {
  AUTOMATION_MAX_ACTIONS,
  AUTOMATION_MAX_CONDITION_DEPTH,
  isOperator,
  isScheduleInterval,
  isSettableField,
  isTriggerEvent,
  type Action,
  type Condition,
  type Trigger,
} from "../types";
import { scriptsEnabled } from "./sandbox";

/** Validates a trigger — an object naming one of the known events, plus an
 *  interval for the scheduled event. */
export function readTrigger(v: unknown): Trigger | { error: string } {
  if (!v || typeof v !== "object") return { error: "trigger must be an object" };
  const o = v as Record<string, unknown>;
  if (!isTriggerEvent(o.event))
    return { error: "trigger.event must be a known event" };
  if (o.event === "schedule.tick") {
    const every = o.every ?? "daily";
    if (!isScheduleInterval(every))
      return { error: "schedule.tick needs a valid interval (hourly/daily/weekly)" };
    return { event: "schedule.tick", every };
  }
  return { event: o.event };
}

/**
 * Validates the condition tree recursively, bounded by a depth cap so a
 * hand-authored payload cannot smuggle in a pathologically deep predicate. The
 * empty object is the legal always-true tree.
 */
export function readCondition(v: unknown, depth = 0): Condition | { error: string } {
  if (depth > AUTOMATION_MAX_CONDITION_DEPTH)
    return { error: "conditions nested too deeply" };
  if (!v || typeof v !== "object") return { error: "a condition must be an object" };
  const o = v as Record<string, unknown>;

  if ("all" in o || "any" in o) {
    const key = "all" in o ? "all" : "any";
    const arr = o[key];
    if (!Array.isArray(arr)) return { error: `${key} must be an array` };
    for (const child of arr) {
      const c = readCondition(child, depth + 1);
      if ("error" in c) return c;
    }
    return v as Condition;
  }
  if ("not" in o) {
    const c = readCondition(o.not, depth + 1);
    if ("error" in c) return c;
    return v as Condition;
  }
  if ("field" in o) {
    if (typeof o.field !== "string" || o.field.trim() === "")
      return { error: "a predicate needs a field" };
    if (!isOperator(o.op)) return { error: "a predicate needs a valid operator" };
    return v as Condition;
  }
  // Neither group nor predicate: only the empty always-true tree is allowed.
  if (Object.keys(o).length === 0) return {} as Condition;
  return { error: "a condition must be a group, a predicate, or empty" };
}

/** Validates a single action. onlyIf, if present, is a nested condition. */
export function readAction(v: unknown): Action | { error: string } {
  if (!v || typeof v !== "object") return { error: "an action must be an object" };
  const o = v as Record<string, unknown>;
  if (o.onlyIf !== undefined) {
    const c = readCondition(o.onlyIf);
    if ("error" in c) return { error: `onlyIf: ${c.error}` };
  }
  switch (o.type) {
    case "move":
      if (!Number.isInteger(o.columnId))
        return { error: "move needs an integer columnId" };
      return v as Action;
    case "assign":
      if (o.assignee !== null) {
        const a = o.assignee as Record<string, unknown> | null;
        if (!a || (a.type !== "human" && a.type !== "agent") || typeof a.id !== "string")
          return { error: "assign needs an assignee {type, id} or null" };
      }
      return v as Action;
    case "set_field":
      if (!isSettableField(o.field))
        return { error: "set_field needs a settable field" };
      if (o.value !== null && typeof o.value !== "string" && typeof o.value !== "number")
        return { error: "set_field value must be a string, number, or null" };
      return v as Action;
    case "add_label":
      if (!Number.isInteger(o.labelId))
        return { error: "add_label needs an integer labelId" };
      return v as Action;
    case "comment":
      if (typeof o.body !== "string" || o.body.trim() === "")
        return { error: "comment needs a non-empty body" };
      return v as Action;
    case "notify": {
      const t = o.target;
        const ok =
          t === "assignee" ||
          (!!t &&
            typeof t === "object" &&
            (((t as Record<string, unknown>).type === "human" &&
              typeof (t as Record<string, unknown>).id === "string") ||
             ((t as Record<string, unknown>).type === "slack" &&
              typeof (t as Record<string, unknown>).channelId === "string") ||
             ((t as Record<string, unknown>).type === "teams" &&
              Number.isInteger((t as Record<string, unknown>).connectionId)) ||
             ((t as Record<string, unknown>).type === "email" &&
              typeof (t as Record<string, unknown>).to === "string" &&
              /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((t as Record<string, unknown>).to as string))));
        if (!ok) return { error: "notify needs assignee, a human, Slack, Teams, or an email address" };
      if (o.message !== undefined && typeof o.message !== "string")
        return { error: "notify message must be a string" };
      return v as Action;
    }
    case "create_task":
      if (typeof o.title !== "string" || o.title.trim() === "")
        return { error: "create_task needs a title" };
      if (o.columnId !== undefined && !Number.isInteger(o.columnId))
        return { error: "create_task columnId must be an integer" };
      return v as Action;
    case "script":
      if (!scriptsEnabled())
        return { error: "scripting is disabled on this server" };
      if (typeof o.code !== "string" || o.code.trim() === "")
        return { error: "script needs code" };
      if (o.code.length > 5000) return { error: "script is too long (max 5000 chars)" };
      return v as Action;
    default:
      return { error: `unknown action type: ${String(o.type)}` };
  }
}

export function readActions(v: unknown): Action[] | { error: string } {
  if (!Array.isArray(v)) return { error: "actions must be an array" };
  if (v.length > AUTOMATION_MAX_ACTIONS)
    return { error: `a rule may have at most ${AUTOMATION_MAX_ACTIONS} actions` };
  const actions: Action[] = [];
  for (const raw of v) {
    const a = readAction(raw);
    if ("error" in a) return a;
    actions.push(a);
  }
  return actions;
}
