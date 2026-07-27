/**
 * AI workflow builder (rock 4.4) — natural language in, a **reviewable rule
 * draft** out. The SPEC's shape is "generation, not silent activation": the
 * model proposes, the server validates against 1.0's own schema, and what comes
 * back is a rule with `isEnabled: false` that an admin reads before enabling.
 *
 * Three properties make that claim true rather than decorative:
 *
 * 1. **The model never emits engine JSON.** It fills a narrow DTO (one trigger,
 *    a flat predicate list, a closed set of action shapes) which `compile` turns
 *    into the engine's `Action[]`. A model that hallucinates a field name
 *    produces a schema violation, not a rule.
 * 2. **The compiled rule walks `validate.ts`** — the same `readTrigger` /
 *    `readCondition` / `readActions` the POST body walks. An illegal draft is an
 *    error the caller sees; nothing is coerced into legality.
 * 3. **Ids are checked against the board.** A `columnId` or `labelId` the model
 *    invented is refused here, where the board's real ids are in hand — the
 *    generic validators only know "integer".
 *
 * `script` is deliberately absent from the DTO: the sandboxed-code action is the
 * highest blast radius in Phase 1 (1.11, admin-only and off by default), and a
 * model drafting code for a human to skim is exactly the review that does not
 * happen. Scripts stay hand-authored.
 *
 * With no `ANTHROPIC_API_KEY` (and no injected `propose`), this degrades to the
 * deterministic constrained-language drafter in `lib/draft.ts` — the same
 * honest-fallback pattern knowledge (4.3) uses for synthesis.
 */

import Anthropic from "@anthropic-ai/sdk";

import { query } from "@/shared/db/client";
import { requireBoardAction } from "@/features/workspaces/server/authz";
import { draftAutomation } from "../lib/draft";
import {
  AUTOMATION_NAME_MAX,
  OPERATORS,
  SCHEDULE_INTERVALS,
  SETTABLE_FIELDS,
  TRIGGER_EVENTS,
  type Action,
  type CreateAutomationRuleInput,
} from "../types";
import { readActions, readCondition, readTrigger } from "./validate";

export interface DraftContext {
  columns: { id: number; title: string }[];
  labels: { id: number; name: string }[];
  members: { id: string; name: string }[];
}

/** The model call, injectable so a test never touches the network. */
export interface DraftDeps {
  propose?: (prompt: string, context: DraftContext) => Promise<unknown>;
}

export interface DraftResult {
  rule: CreateAutomationRuleInput;
  /** Which drafter produced it — the UI says so, so nobody mistakes the
   *  phrasebook fallback for comprehension. */
  source: "model" | "phrasebook";
}

/** Prompts longer than this are a spec, not a sentence. */
const PROMPT_MAX = 1000;

/**
 * The DTO the model fills. Not the engine's shape: flat, closed, and free of
 * the recursive condition tree (structured outputs cannot express recursion,
 * and one level of AND covers what a described rule actually needs — deeper
 * logic is authored in the builder).
 */
const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "event", "every", "conditions", "actions"],
  properties: {
    name: { type: "string", description: "A short rule name, under 80 characters." },
    event: { type: "string", enum: [...TRIGGER_EVENTS] },
    every: {
      type: ["string", "null"],
      enum: [...SCHEDULE_INTERVALS, null],
      description: "Only for schedule.tick; null otherwise.",
    },
    conditions: {
      type: "array",
      description:
        "Predicates ANDed together against the task snapshot. Empty means the rule fires on every occurrence of the event.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "op", "value"],
        properties: {
          field: {
            type: "string",
            description:
              "A task snapshot field: title, priority, type, estimate, columnTitle, dueDate, assignee.id, labels.",
          },
          op: { type: "string", enum: [...OPERATORS] },
          value: {
            type: ["string", "number", "null"],
            description: "Null for the unary operators isSet and isEmpty.",
          },
        },
      },
    },
    actions: {
      type: "array",
      description: "What the rule does, in order. At least one.",
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "columnId"],
            properties: {
              type: { const: "move" },
              columnId: { type: "integer", description: "An id from the board's columns." },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "memberId"],
            properties: {
              type: { const: "assign" },
              memberId: {
                type: ["string", "null"],
                description: "A workspace member id, or null to unassign.",
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "field", "value"],
            properties: {
              type: { const: "set_field" },
              field: { type: "string", enum: [...SETTABLE_FIELDS] },
              value: { type: ["string", "number", "null"] },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "labelId"],
            properties: {
              type: { const: "add_label" },
              labelId: { type: "integer", description: "An id from the workspace's labels." },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "body"],
            properties: {
              type: { const: "comment" },
              body: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "message"],
            properties: {
              type: { const: "notify" },
              message: { type: ["string", "null"], description: "Pings the task's assignee." },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "title", "columnId"],
            properties: {
              type: { const: "create_task" },
              title: { type: "string" },
              columnId: { type: ["integer", "null"] },
            },
          },
        ],
      },
    },
  },
} as const;

/**
 * Loads the board's vocabulary, then drafts. Gated at **admin** (or an explicit
 * `automation.manage` grant) — the same gate authoring a rule takes, because a
 * draft is the first half of authoring one and the ids it returns are the
 * board's structure.
 */
export async function draftAutomationForBoard(
  userId: string,
  boardId: number,
  prompt: string,
  deps: DraftDeps = {}
): Promise<DraftResult | { error: string }> {
  const { workspaceId } = await requireBoardAction(userId, boardId, "automation.manage");

  const [columns, labels, members] = await Promise.all([
    query<{ id: number; title: string }>(
      `SELECT id, title FROM board_column WHERE board_id = $1 ORDER BY position, id`,
      [boardId]
    ),
    query<{ id: number; name: string }>(
      `SELECT id, name FROM label WHERE workspace_id = $1 ORDER BY lower(name)`,
      [workspaceId]
    ),
    // Names, not emails: the drafter needs to resolve "assign it to Dana", and
    // the member list's addresses are PII this path has no use for.
    query<{ id: string; name: string }>(
      `SELECT u.id, u.name FROM workspace_member wm
         JOIN "user" u ON u.id = wm.user_id
        WHERE wm.workspace_id = $1
        ORDER BY lower(u.name)`,
      [workspaceId]
    ),
  ]);

  return draftRule(prompt, { columns, labels, members }, deps);
}

/** The pure half: prompt + board vocabulary → a validated, disabled draft. */
export async function draftRule(
  prompt: string,
  context: DraftContext,
  deps: DraftDeps = {}
): Promise<DraftResult | { error: string }> {
  const text = prompt.trim();
  if (!text) return { error: "Describe the automation you want." };
  if (text.length > PROMPT_MAX)
    return { error: `Keep the description under ${PROMPT_MAX} characters.` };

  const propose =
    deps.propose ?? (process.env.ANTHROPIC_API_KEY ? proposeWithModel : null);

  if (propose) {
    let proposed: unknown;
    try {
      proposed = await propose(text, context);
    } catch {
      // A model outage falls back to the phrasebook rather than 500ing — the
      // deterministic drafter still handles the common sentences.
      proposed = null;
    }
    if (proposed !== null && proposed !== undefined) {
      const rule = compile(proposed, context);
      // An illegal proposal is reported, never repaired and never quietly
      // downgraded to the phrasebook: the admin should see that the model
      // described something this board cannot express.
      return "error" in rule ? rule : { rule, source: "model" };
    }
  }

  const fallback = draftAutomation(text, context.columns);
  if (!fallback)
    return {
      error:
        "Could not turn that into a rule. Try: “When a PR merges, move it to Done” or “When CI fails, comment: investigate”.",
    };
  return { rule: fallback, source: "phrasebook" };
}

/**
 * DTO → engine shape → the API's own validators → board-id existence. Every
 * failure is an error string; nothing falls through as a half-built rule.
 */
function compile(
  proposed: unknown,
  context: DraftContext
): CreateAutomationRuleInput | { error: string } {
  if (!proposed || typeof proposed !== "object")
    return { error: "The model did not return a rule." };
  const p = proposed as Record<string, unknown>;

  const name =
    typeof p.name === "string" && p.name.trim() !== ""
      ? p.name.trim().slice(0, AUTOMATION_NAME_MAX)
      : "Draft automation";

  const trigger = readTrigger({ event: p.event, every: p.every ?? undefined });
  if ("error" in trigger) return trigger;

  const predicates = Array.isArray(p.conditions) ? p.conditions : [];
  const conditions = readCondition(
    predicates.length
      ? {
          all: predicates.map((c) => {
            const o = (c ?? {}) as Record<string, unknown>;
            // isSet/isEmpty are unary; carrying a null value through would make
            // the predicate look like an equality against null.
            return o.value === null || o.value === undefined
              ? { field: o.field, op: o.op }
              : { field: o.field, op: o.op, value: o.value };
          }),
        }
      : {}
  );
  if ("error" in conditions) return conditions;

  const raw = Array.isArray(p.actions) ? p.actions : [];
  if (!raw.length) return { error: "The model returned a rule with no actions." };
  const compiled: unknown[] = [];
  for (const item of raw) {
    const a = compileAction(item, context);
    if (a && typeof a === "object" && "error" in a) return a as { error: string };
    compiled.push(a);
  }

  const actions = readActions(compiled);
  if ("error" in actions) return actions;

  return { name, trigger, conditions, actions: actions as Action[], isEnabled: false };
}

function compileAction(
  item: unknown,
  context: DraftContext
): unknown | { error: string } {
  if (!item || typeof item !== "object") return { error: "an action must be an object" };
  const o = item as Record<string, unknown>;
  switch (o.type) {
    case "move":
      if (!context.columns.some((c) => c.id === o.columnId))
        return { error: `The model named a column this board does not have.` };
      return { type: "move", columnId: o.columnId };
    case "assign":
      if (o.memberId === null) return { type: "assign", assignee: null };
      if (!context.members.some((m) => m.id === o.memberId))
        return { error: "The model named someone who is not a member of this workspace." };
      return { type: "assign", assignee: { type: "human", id: o.memberId } };
    case "set_field":
      return { type: "set_field", field: o.field, value: o.value ?? null };
    case "add_label":
      if (!context.labels.some((l) => l.id === o.labelId))
        return { error: "The model named a label this workspace does not have." };
      return { type: "add_label", labelId: o.labelId };
    case "comment":
      return { type: "comment", body: o.body };
    case "notify":
      return typeof o.message === "string" && o.message.trim() !== ""
        ? { type: "notify", target: "assignee", message: o.message }
        : { type: "notify", target: "assignee" };
    case "create_task":
      if (o.columnId !== null && o.columnId !== undefined) {
        if (!context.columns.some((c) => c.id === o.columnId))
          return { error: "The model named a column this board does not have." };
        return { type: "create_task", title: o.title, columnId: o.columnId };
      }
      return { type: "create_task", title: o.title };
    default:
      return { error: `The model proposed an action this engine has no door for.` };
  }
}

/**
 * The default proposer: one capped, schema-constrained call. The board's
 * vocabulary rides in the user turn (ids and names), so the model names real
 * columns and labels rather than describing them in prose.
 */
async function proposeWithModel(
  prompt: string,
  context: DraftContext
): Promise<unknown> {
  const client = new Anthropic();
  const vocabulary = [
    `Columns: ${context.columns.map((c) => `${c.id}=${c.title}`).join(", ") || "none"}`,
    `Labels: ${context.labels.map((l) => `${l.id}=${l.name}`).join(", ") || "none"}`,
    `Members: ${context.members.map((m) => `${m.id}=${m.name}`).join(", ") || "none"}`,
  ].join("\n");

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 4000,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: DRAFT_SCHEMA as unknown as Record<string, unknown> },
    },
    system:
      "You translate a described kanban automation into one rule for an existing engine. " +
      "Use ONLY the column, label, and member ids given — never invent one; if the description " +
      "names something absent, choose the closest action the ids allow or leave that action out. " +
      "Prefer the fewest conditions that capture the description. The rule is reviewed by a human " +
      "before it is enabled, so be literal about what was asked rather than helpful beyond it.",
    messages: [
      { role: "user", content: `Board vocabulary:\n${vocabulary}\n\nAutomation to build: ${prompt}` },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
