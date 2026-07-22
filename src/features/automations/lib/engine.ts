/**
 * The pure core of the automation engine (045): `evaluate` decides whether a
 * rule's conditions hold against an event snapshot, and `planActions` turns a
 * rule's action list into the ordered effects the runner applies. Neither
 * touches the database — this is the derive-don't-store heart, exhaustively
 * unit-tested, and the runner is the only thing that writes.
 *
 * Everything here is *total*: no field access, operator, or malformed value
 * throws. A rule runs inside the tail of the mutation that triggered it, so a
 * predicate that blew up on a missing field would take down an ordinary task
 * edit. A missing field is simply not-set, an unknown operator is false, and a
 * malformed action is dropped.
 */

import type {
  Action,
  Actor,
  Condition,
  NotifyTarget,
  Operator,
  Predicate,
  SettableField,
  SettableValue,
} from "../types";

/** The fact a condition reads — in practice a TaskSnapshot, but treated opaquely. */
export type Snapshot = Record<string, unknown>;

/**
 * A planned action the runner will apply — an Action with its `onlyIf` branch
 * already resolved away by planActions, so an Effect is unconditional.
 */
export type Effect =
  | { type: "move"; columnId: number }
  | { type: "assign"; assignee: Actor | null }
  | { type: "set_field"; field: SettableField; value: SettableValue }
  | { type: "add_label"; labelId: number }
  | { type: "comment"; body: string }
  | { type: "notify"; target: NotifyTarget; message?: string };

/**
 * Resolves a possibly-dotted field path against the snapshot ("assignee.id"
 * walks into the Actor). Returns undefined for any missing hop rather than
 * throwing — the "not set" value every operator is defined against.
 */
export function resolveField(snapshot: Snapshot, field: string): unknown {
  let cursor: unknown = snapshot;
  for (const key of field.split(".")) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Applies one operator. Total by construction: comparisons on non-numbers are
 * false, `contains`/`in` on the wrong shapes are false, and the unary set-tests
 * treat null/undefined/""/[] as empty.
 */
export function compare(op: Operator, actual: unknown, value: unknown): boolean {
  switch (op) {
    case "eq":
      return actual === value;
    case "neq":
      return actual !== value;
    case "lt":
      return isNumber(actual) && isNumber(value) && actual < value;
    case "lte":
      return isNumber(actual) && isNumber(value) && actual <= value;
    case "gt":
      return isNumber(actual) && isNumber(value) && actual > value;
    case "gte":
      return isNumber(actual) && isNumber(value) && actual >= value;
    case "contains":
      if (typeof actual === "string")
        return typeof value === "string" && actual.includes(value);
      if (Array.isArray(actual))
        // Membership, and — so a rule can match a task's label set — membership
        // by id in an array of {labelId}/{id} objects (LabelRef), not only by
        // whole-object identity.
        return actual.some(
          (el) =>
            el === value ||
            (el != null &&
              typeof el === "object" &&
              ((el as Record<string, unknown>).labelId === value ||
                (el as Record<string, unknown>).id === value))
        );
      return false;
    case "in":
      return Array.isArray(value) && value.includes(actual);
    case "isSet":
      return actual != null;
    case "isEmpty":
      return (
        actual == null ||
        actual === "" ||
        (Array.isArray(actual) && actual.length === 0)
      );
    default:
      // An action/condition JSON written by newer code can carry an operator
      // this build has never heard of (003's forward-compat rule). Unknown → no
      // match, never a throw.
      return false;
  }
}

function isPredicate(c: Condition): c is Predicate {
  return typeof (c as Predicate).field === "string";
}

/**
 * Evaluates a condition tree. The empty tree `{}` — the column default — is
 * always-true, so a rule with no conditions fires on every trigger. Groups
 * short-circuit (`all` on the first false, `any` on the first true), and the
 * whole thing is bounded by the tree the author could store (validated to a max
 * depth on write), so no recursion guard is needed here.
 */
export function evaluate(condition: Condition, snapshot: Snapshot): boolean {
  if ("all" in condition) return condition.all.every((c) => evaluate(c, snapshot));
  if ("any" in condition) return condition.any.some((c) => evaluate(c, snapshot));
  if ("not" in condition) return !evaluate(condition.not, snapshot);
  if (isPredicate(condition))
    return compare(condition.op, resolveField(snapshot, condition.field), condition.value);
  // No all/any/not/field: the always-true empty tree.
  return true;
}

/**
 * Turns a rule's actions into the effects to apply, in order. Two pure
 * decisions live here so the runner stays a thin applier:
 *
 *   1. per-action branching (1.2) — an action carrying `onlyIf` is kept only
 *      when its sub-condition holds against this snapshot;
 *   2. no-op elision — a `move` to the column the task is already in is dropped,
 *      so a "when moved, move to Done" rule does not re-fire itself forever
 *      (the depth cap is the backstop; this removes the commonest cause).
 *
 * The `onlyIf` is stripped from the returned effect: an Effect is unconditional.
 */
export function planActions(actions: Action[], snapshot: Snapshot): Effect[] {
  const effects: Effect[] = [];
  for (const action of actions) {
    if (action.onlyIf && !evaluate(action.onlyIf, snapshot)) continue;
    if (action.type === "move" && action.columnId === snapshot.columnId) continue;
    // Drop the branch guard; an Effect is unconditional. A shallow copy minus
    // onlyIf rather than a destructure, to keep the linter's unused-var rule
    // happy without a throwaway binding.
    const effect: Record<string, unknown> = { ...action };
    delete effect.onlyIf;
    effects.push(effect as unknown as Effect);
  }
  return effects;
}
