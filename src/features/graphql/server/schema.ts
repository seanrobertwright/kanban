import { type ExecutionResult, buildSchema, graphql } from "graphql";

import type { Principal } from "@/features/auth/server/principal";
import { getBoard } from "@/features/board/server/repository";
import { getTask } from "@/features/tasks/server/repository";
import type { Task } from "@/features/tasks/types";

/**
 * GraphQL API (2.9) — a second *shape* over the read model, not a second
 * permission system. Every resolver goes through the same repository the REST
 * routes and the agent tools do (getBoard/getTask), so it inherits the exact
 * `requireBoardRole`/`requireTaskRole` gates and the same principal (an agent
 * token or a human session). A query for a board the caller cannot read fails the
 * same way a GET would — the authz lives in the repository, and GraphQL only
 * re-expresses what it returns.
 *
 * Read-first by design (the SPEC's word): the schema covers the board tree
 * (columns → tasks) and its milestones. Mutations phase in later behind the same
 * gates as the REST routes; keeping the first cut read-only keeps the blast radius
 * of a new API surface to zero.
 */
export const schema = buildSchema(`
  type Query {
    "A board and its tree, or null if the caller cannot read it."
    board(id: Int!): Board
    "A single task by id, or null if the caller cannot read it."
    task(id: Int!): Task
  }

  type Board {
    id: Int!
    name: String!
    columns: [Column!]!
    milestones: [Milestone!]!
  }

  type Column {
    id: Int!
    title: String!
    wipLimit: Int
    tasks: [Task!]!
  }

  type Task {
    id: Int!
    columnId: Int!
    title: String!
    description: String!
    position: Int!
    priority: String!
    type: String!
    estimate: Int
    milestoneId: Int
    dueDate: String
  }

  type Milestone {
    id: Int!
    name: String!
    done: Int!
    total: Int!
  }
`);

/** The GraphQL Task shape, flattened from the repository's Task (three-valued
 *  fields default to null, GraphQL's absent). */
function shapeTask(t: Task) {
  return {
    id: t.id,
    columnId: t.columnId,
    title: t.title,
    description: t.description,
    position: t.position,
    priority: t.priority,
    type: t.type,
    estimate: t.estimate ?? null,
    milestoneId: t.milestoneId ?? null,
    dueDate: t.dueDate ?? null,
  };
}

interface Context {
  principal: string | Principal;
}

// The root resolvers. Only the Query fields need one — nested types (Board.columns
// → Column.tasks) resolve by property off the pre-shaped tree, GraphQL's default.
const root = {
  board: async ({ id }: { id: number }, ctx: Context) => {
    const data = await getBoard(ctx.principal, id);
    if (!data) return null;
    return {
      id: data.board.id,
      name: data.board.name,
      columns: data.columns.map((c) => ({
        id: c.id,
        title: c.title,
        wipLimit: c.wipLimit,
        tasks: data.tasks.filter((t) => t.columnId === c.id).map(shapeTask),
      })),
      milestones: data.milestones.map((m) => ({
        id: m.id,
        name: m.name,
        done: m.done,
        total: m.total,
      })),
    };
  },
  task: async ({ id }: { id: number }, ctx: Context) => {
    const t = await getTask(ctx.principal, id);
    return t ? shapeTask(t) : null;
  },
};

/**
 * Executes one operation as the given principal. Returns the standard GraphQL
 * `{ data, errors }` — an authz failure inside a resolver surfaces as a GraphQL
 * error with a null field, never a thrown 500, so a partial query still returns
 * what the caller *can* see.
 */
export function executeGraphQL(
  principal: string | Principal,
  source: string,
  variableValues?: Record<string, unknown> | null
): Promise<ExecutionResult> {
  return graphql({
    schema,
    source,
    rootValue: root,
    contextValue: { principal } satisfies Context,
    variableValues: variableValues ?? undefined,
  });
}
