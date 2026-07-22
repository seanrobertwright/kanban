import vm from "node:vm";

import type { Effect, Snapshot } from "../lib/engine";

/**
 * Custom scripts / functions (rock 1.11) — the sandbox. The highest-risk rock, so
 * it ships last, behind a config flag (AUTOMATION_SCRIPTS_ENABLED), admin-authored
 * only. Its safety rests on one design choice above all:
 *
 *   The script has NO capabilities. It receives a frozen copy of the task and
 *   returns a list of *effect descriptors* — plain JSON. It never touches the
 *   database, the filesystem, the network, or any repository. The engine then
 *   re-validates every returned effect (validateEffect) and applies it through
 *   the same gated repositories a rule's declared actions use. So the worst a
 *   script can produce is an ordinary, validated action its admin author could
 *   already declare by hand — computed instead of typed.
 *
 * The remaining risks the sandbox itself addresses:
 *   • runaway CPU — a hard timeout (node:vm interrupts synchronous loops).
 *   • ambient Node globals — the context is empty: no require, process, global,
 *     fetch, Buffer, setTimeout. Only `task` is present.
 *
 * Honest limitation: node:vm is NOT a hard security boundary — a determined
 * author can reach the Function constructor and escape into the Node process.
 * That is acceptable here because authoring is admin-only (an admin already
 * commands the server through the legitimate API) and the feature is off by
 * default. For untrusted authors, swap node:vm for isolated-vm (a real V8
 * isolate) behind this same interface — runScript is the only seam that changes.
 */

const SCRIPT_TIMEOUT_MS = 100;

/** Effect types a script may emit — the safe subset, minus `script` itself, so a
 *  script cannot recurse into another sandbox. */
const SCRIPT_EFFECT_TYPES = new Set([
  "move",
  "set_field",
  "add_label",
  "comment",
  "notify",
  "create_task",
]);

export function scriptsEnabled(): boolean {
  return process.env.AUTOMATION_SCRIPTS_ENABLED === "true";
}

/** Re-validates one script-returned descriptor into a trusted Effect, or null. */
function validateEffect(raw: unknown): Effect | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.type !== "string" || !SCRIPT_EFFECT_TYPES.has(o.type)) return null;
  switch (o.type) {
    case "move":
      return Number.isInteger(o.columnId) ? ({ type: "move", columnId: o.columnId } as Effect) : null;
    case "set_field":
      return typeof o.field === "string"
        ? ({ type: "set_field", field: o.field, value: o.value } as Effect)
        : null;
    case "add_label":
      return Number.isInteger(o.labelId) ? ({ type: "add_label", labelId: o.labelId } as Effect) : null;
    case "comment":
      return typeof o.body === "string" && o.body.trim() !== ""
        ? ({ type: "comment", body: o.body } as Effect)
        : null;
    case "notify":
      return o.target === "assignee" ||
        (!!o.target && typeof o.target === "object")
        ? ({ type: "notify", target: o.target, message: o.message } as Effect)
        : null;
    case "create_task":
      return typeof o.title === "string" && o.title.trim() !== ""
        ? ({ type: "create_task", title: o.title, columnId: o.columnId, priority: o.priority } as Effect)
        : null;
    default:
      return null;
  }
}

/**
 * Runs an admin-authored script against a task snapshot and returns the effects
 * it emits. The script body should `return` an array of effect descriptors, e.g.
 *   if (task.priority === 'urgent') return [{ type: 'comment', body: 'escalated' }];
 *   return [];
 * Anything not a valid effect is dropped. Throws on a timeout or a script error.
 */
export function runScript(code: string, snapshot: Snapshot): Effect[] {
  // A structured, frozen clone: the script cannot mutate the engine's snapshot,
  // and gets no live object references back into the app.
  const task = Object.freeze(JSON.parse(JSON.stringify(snapshot)));
  // Empty context — no Node globals leak in. `task` is the only binding.
  const context = vm.createContext(Object.create(null));
  const wrapped = `"use strict";(function(task){\n${code}\n})(Object.freeze(${JSON.stringify(task)}))`;
  const result = vm.runInContext(wrapped, context, {
    timeout: SCRIPT_TIMEOUT_MS,
    displayErrors: false,
  });
  if (!Array.isArray(result)) return [];
  return result.map(validateEffect).filter((e): e is Effect => e !== null);
}
