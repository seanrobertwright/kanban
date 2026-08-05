import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Dry run (code review §4.4 item 9) — "what would this do?", answered without
 * doing it.
 *
 * An agent's mutation is gated by tier (§7.4): it applies now, or it is held for
 * a human, or it is refused. Until this existed the only way to learn which was
 * to send the mutation, and two of the three outcomes leave something behind — a
 * board change, or a proposal in a human's review queue. An agent deciding
 * between three phrasings of a move had to spend a real proposal on each.
 *
 * `Dry-Run: true` answers the same question with nothing written: the tier the
 * call would run under, the task's real current state, and the state the call is
 * asking for. It reuses the gate's own before-snapshot machinery, so the `before`
 * in a dry run is the same RBAC-scoped read the real mutation would have taken.
 *
 * **The guarantee is enforced at the pool, not by discipline.** Recording a plan
 * instead of mutating is something each seam has to remember to do, and a seam
 * that forgets would write for real while answering "nothing was written" — the
 * worst failure this feature could have. So `query` and `withTransaction` refuse
 * to write while a dry run is open (`assertReadOnly` below). A handler that
 * reaches a write in dry-run mode throws instead, and the caller gets a 501
 * saying this endpoint has no dry run — which is a true statement, and one that
 * costs nothing, where a silent mutation costs a board.
 *
 * Agents only. A dry run is a promise that a request did not apply, and this
 * module can only keep that promise on the paths that pass a gate seam — every
 * one of which is an agent path. A human's browser sending the header would get
 * the promise without the enforcement on some routes, so it is refused outright
 * rather than honoured unevenly.
 *
 * **This file imports nothing.** `client.ts` calls `assertReadOnly` on every
 * statement, so anything this module pulls in is pulled in by the pool — and the
 * route wrapper needs the auth layer, which needs the pool. That cycle builds
 * and typechecks and then fails at runtime as a TDZ error on `pool` inside a
 * page render, which is a long way from its cause. The wrapper therefore lives
 * next door in `with-dry-run.ts`, and this stays a leaf.
 */

export const DRY_RUN_HEADER = "dry-run";

/** What a dry run reports for one would-be action. */
export interface DryRunPlan {
  /** The gated tool name — the same string DEFAULT_TIER keys on. */
  tool: string;
  /** The tier this call would run under for this agent, policy included. */
  tier: "auto" | "changeset" | "block";
  outcome: "would_apply" | "would_hold" | "would_block";
  /** The task this targets, or null for a create. */
  taskId: number | null;
  /** The target's real current state, read as this agent. Null for a create. */
  before: unknown;
  /** `before` with the request's fields applied — what the caller is asking
   *  for, not what the server would compute. Null when the tool edits no field
   *  of the target (a comment, a checklist item: its effect is a new row). */
  after: unknown;
  /** Keys of `after` that differ from `before`. */
  changed: string[];
  /** Input keys that name no field of the target, so the projection could not
   *  place them. Their presence is how a reader tells "this changes nothing"
   *  from "this tool's effect is not a field edit". */
  unprojected: string[];
}

interface DryRunContext {
  plans: DryRunPlan[];
}

const storage = new AsyncLocalStorage<DryRunContext>();

/** True while a dry run is open on this async context. */
export const dryRunActive = (): boolean => storage.getStore() !== undefined;

/**
 * Record one would-be action. Seams call this INSTEAD of mutating; the wrapper
 * turns everything recorded into the response, so a handler that plans two
 * actions (a PATCH that both moves and reassigns) reports both.
 */
export function planDryRun(plan: DryRunPlan): void {
  storage.getStore()?.plans.push(plan);
}

/**
 * The response a seam returns after planning. It never reaches a client — the
 * wrapper replaces it with the collected plans — and exists only because a
 * handler's control flow needs *something* Response-shaped to return early.
 */
export const dryRunPending = (): Response => new Response(null, { status: 204 });

/** Thrown when a write is attempted inside a dry run. Not an AuthzError: it is
 *  a statement about this server's coverage, not about the caller's rights. */
export class DryRunViolation extends Error {
  constructor(readonly statement: string) {
    super(
      `A dry run reached a write (${statement}). Nothing was applied; this ` +
        `endpoint does not support Dry-Run.`
    );
    this.name = "DryRunViolation";
  }
}

/** Statements that read. `WITH` is here because every CTE query starts with it;
 *  a data-modifying CTE is caught by the second test in `isReadOnlySql`. */
const READ_VERBS = new Set(["SELECT", "WITH", "SHOW", "EXPLAIN", "TABLE", "VALUES"]);

/** Statements that write, anywhere in the text — the data-modifying CTE case
 *  (`WITH x AS (DELETE …) SELECT …`), which passes any first-keyword test. */
const WRITE_VERBS =
  /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|DROP|ALTER|GRANT|REVOKE|COPY|CALL|VACUUM|REINDEX|REFRESH|LOCK|NOTIFY)\b/i;

/**
 * Whether a statement only reads.
 *
 * Literals and quoted identifiers are stripped before the keywords are read, and
 * that is not a nicety: this schema logs activity actions like `'task.update'`
 * and `'comment.delete'` as literal strings, so a keyword scan over raw SQL
 * would call half the SELECTs in the app writes.
 *
 * `FOR UPDATE` is removed for the same reason in reverse — it is a locking read,
 * and the word in it is not a verb. Deliberately conservative everywhere else:
 * an unrecognised statement is treated as a write, so the failure mode of a gap
 * here is a refused dry run rather than an applied one.
 */
export function isReadOnlySql(text: string): boolean {
  const stripped = text
    // Comments first: a `--` line could otherwise contribute a keyword, and a
    // quote inside one would unbalance the literal stripping below.
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // '' is the escape for a quote inside a literal, so the alternation has to
    // consume it rather than treat it as two literal boundaries.
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/\bFOR\s+(NO\s+KEY\s+)?UPDATE\b/gi, " ")
    .replace(/\bFOR\s+(SHARE|KEY\s+SHARE)\b/gi, " ")
    .trim();

  const verb = stripped.match(/^\(*\s*([A-Za-z]+)/)?.[1]?.toUpperCase();
  if (!verb || !READ_VERBS.has(verb)) return false;
  return !WRITE_VERBS.test(stripped);
}

/** The pool's guard. A no-op — one AsyncLocalStorage lookup — when no dry run is
 *  open, which is every request but the ones that asked for this. */
export function assertReadOnly(text: string): void {
  if (!dryRunActive()) return;
  if (isReadOnlySql(text)) return;
  throw new DryRunViolation(text.trim().split(/\s+/, 2).join(" ").slice(0, 60));
}

/** Keys that name the target rather than edit it. `id` is also a field of the
 *  before snapshot, so without this it would project (harmlessly) as unchanged;
 *  `taskId` is not, so it would report as unprojected on every Door-2 call. */
const IDENTITY_KEYS = new Set(["id", "taskId"]);

/**
 * `before` with the caller's fields applied.
 *
 * A projection, not a simulation: it says what the caller asked for, checked
 * against real current state. Server-computed effects — the position a move
 * settles at, a cascade, a generated column — are not in it, because computing
 * them means running the mutation, and running it is the one thing a dry run
 * must not do.
 *
 * Input keys that name no field of the target are collected rather than merged
 * in. That is what makes the answer honest for a tool whose effect is a new row:
 * `comment_on_task` changes no field of the task, and reporting `changed: []`
 * alone would read as "this does nothing" when the truth is "this does something
 * a field diff cannot show".
 */
export function projectAfter(
  before: unknown,
  input: unknown
): { after: unknown; changed: string[]; unprojected: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { after: before ?? null, changed: [], unprojected: [] };
  }
  const fields = input as Record<string, unknown>;

  // An explicit undefined is not a field the caller set. JSON cannot carry one,
  // so this is never about a request body — it is about the patch objects the
  // handlers build, which write `priority: undefined` for the two-valued fields
  // a PATCH did not mention (the repository reads their value, not their
  // presence). Merging those would report a title-only edit as changing four
  // fields, each of them to nothing.
  const said = (key: string) =>
    !IDENTITY_KEYS.has(key) && fields[key] !== undefined;

  // A create: there is no before, so the request IS the after and every field
  // it names is a change.
  if (!before || typeof before !== "object") {
    const named = Object.keys(fields).filter(said);
    return {
      after: Object.fromEntries(named.map((key) => [key, fields[key]])),
      changed: named,
      unprojected: [],
    };
  }

  const current = before as Record<string, unknown>;
  const after: Record<string, unknown> = { ...current };
  const changed: string[] = [];
  const unprojected: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    // The id the caller repeated back to name the target is not a field edit in
    // any tool, and reporting it as unprojected on every call would be noise.
    if (!said(key)) continue;
    if (!(key in current)) {
      unprojected.push(key);
      continue;
    }
    after[key] = value;
    // Structural comparison: labelIds is an array and assignee an object, and
    // `!==` would call every unchanged one a change.
    if (JSON.stringify(current[key]) !== JSON.stringify(value)) changed.push(key);
  }

  return { after, changed, unprojected };
}

/**
 * Open a dry-run context around `work` and hand back what it planned. The route
 * wrapper (`with-dry-run.ts`) is the only caller; it lives in another module
 * because it needs the auth layer to resolve a principal, and the auth layer
 * needs the pool — so a wrapper in *this* file would make `client.ts` import
 * itself through two hops. The guard has to be a leaf, and this is the seam that
 * keeps it one.
 */
export async function runAsDryRun(
  work: () => Promise<Response>
): Promise<{ response: Response; plans: DryRunPlan[] }> {
  const context: DryRunContext = { plans: [] };
  const response = await storage.run(context, work);
  return { response, plans: context.plans };
}

/**
 * The answer for a mutation this server will not simulate.
 *
 * Some outcomes cannot be projected without producing them. A claim's answer
 * depends on whether a lease is live *at the instant of the write*, decided by
 * the repository under a row lock on the database clock — read it without taking
 * it and the answer is a guess that goes stale between the read and the caller.
 * A confident wrong "would_apply" is worse for an agent than a plain refusal, so
 * those endpoints say so instead, with the reason.
 */
export const dryRunUnsupported = (tool: string, because: string): Response =>
  Response.json(
    {
      dryRun: true,
      code: "DRY_RUN_UNSUPPORTED",
      error: `"${tool}" cannot be dry-run: ${because}. Nothing was written.`,
    },
    { status: 501 }
  );

/** The body a completed dry run answers with — one shape, whether the request
 *  planned one action or three. Built by the route wrapper. */
export const dryRunBody = (plans: DryRunPlan[]) =>
  Response.json(
    {
      dryRun: true,
      actions: plans,
      message:
        "Nothing was written. Each action reports the tier it would run under " +
        "(would_apply now, would_hold for a human's review, or would_block), " +
        "the target's real current state, and that state with your fields " +
        "applied. Server-computed effects are not projected.",
    },
    { status: 200, headers: { [DRY_RUN_HEADER]: "true" } }
  );
