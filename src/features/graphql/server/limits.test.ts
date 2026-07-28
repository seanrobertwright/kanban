import { parse } from "graphql";
import { describe, expect, it } from "vitest";

import {
  MAX_COST,
  MAX_DEPTH,
  MAX_ROOT_FIELDS,
  checkQueryLimits,
  estimateCost,
} from "./limits";
import { schema } from "./schema";

/**
 * The GraphQL guard rails (2.9). Pure: every check is static analysis of a parsed
 * document, so none of this needs a database — which is the point. A rejected
 * query must cost a parse and nothing else.
 *
 * The two directions both matter. A limit that rejects an attack but also rejects
 * the query the board UI would send is not a guard rail, it is an outage, so the
 * first test pins the honest ceiling: a whole board with every task field has to
 * stay comfortably inside the budget.
 */

/** Every field the schema exposes, three levels down — the most expensive query a
 *  legitimate client has any reason to send. */
const WHOLE_BOARD = `
  query ($id: Int!) {
    board(id: $id) {
      id
      name
      milestones { id name done total }
      columns {
        id
        title
        wipLimit
        tasks {
          id columnId title description position priority type estimate milestoneId dueDate
        }
      }
    }
  }
`;

describe("checkQueryLimits", () => {
  it("passes the most expensive legitimate query", () => {
    const document = parse(WHOLE_BOARD);
    expect(checkQueryLimits(schema, document)).toEqual([]);
    // Pinned so a future tightening of the constants has to look at this number
    // and decide on purpose, rather than discovering it in production.
    expect(estimateCost(schema, document)).toBeLessThan(MAX_COST);
  });

  it("rejects alias amplification — the attack this schema is actually open to", () => {
    // Two levels deep, trivially cheap per field, and one repository round trip
    // per alias. Depth and cost limits both wave it through; the root-field cap
    // is what stops it.
    const aliases = Array.from(
      { length: MAX_ROOT_FIELDS + 5 },
      (_, i) => `a${i}: board(id: ${i + 1}) { id }`
    ).join("\n");
    const errors = checkQueryLimits(schema, parse(`{ ${aliases} }`));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/root fields/);
    expect(errors[0].extensions?.code).toBe("QUERY_LIMIT_EXCEEDED");
  });

  it("counts root fields through fragment spreads", () => {
    // The same attack, hidden one indirection down. Counting only the operation's
    // own selections would miss it entirely.
    const aliases = Array.from(
      { length: MAX_ROOT_FIELDS + 5 },
      (_, i) => `a${i}: board(id: ${i + 1}) { id }`
    ).join("\n");
    const errors = checkQueryLimits(
      schema,
      parse(`query { ...Many } fragment Many on Query { ${aliases} }`)
    );
    expect(errors.some((e) => /root fields/.test(e.message))).toBe(true);
  });

  it("rejects a query whose list selections are too expensive", () => {
    // One root field, four levels deep — inside both other limits. What makes it
    // expensive is that the server pays for each of those 30 aliases once per
    // task, once per column.
    const fields = Array.from({ length: 30 }, (_, i) => `f${i}: id`).join(" ");
    const errors = checkQueryLimits(
      schema,
      parse(`{ board(id: 1) { columns { tasks { ${fields} } } } }`)
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/cost/);
  });

  it("rejects a query deeper than the limit", () => {
    // Nothing in today's schema is cyclic, so the spec's own validation would
    // also reject this. The depth rule is the guard that is already in place for
    // the commit that adds a back-edge (Task.parent, Column.board) and makes an
    // unbounded query expressible.
    let selection = "id";
    for (let i = 0; i < MAX_DEPTH + 2; i++) selection = `nested { ${selection} }`;
    const errors = checkQueryLimits(schema, parse(`{ board(id: 1) { ${selection} } }`));
    expect(errors.some((e) => /levels deep/.test(e.message))).toBe(true);
  });

  it("does not measure introspection depth", () => {
    // A tooling introspection query is legitimately ~11 levels deep and touches
    // no repository. Measuring it would break GraphiQL and codegen to protect
    // nothing.
    const errors = checkQueryLimits(
      schema,
      parse(`{
        __schema {
          types {
            name
            fields { name type { name ofType { name ofType { name ofType { name } } } } }
          }
        }
      }`)
    );
    expect(errors).toEqual([]);
  });

  it("checks every operation in the document, not just the first", () => {
    const aliases = Array.from(
      { length: MAX_ROOT_FIELDS + 5 },
      (_, i) => `a${i}: board(id: ${i + 1}) { id }`
    ).join("\n");
    const errors = checkQueryLimits(
      schema,
      parse(`query Small { board(id: 1) { id } } query Big { ${aliases} }`)
    );
    expect(errors.some((e) => /root fields/.test(e.message))).toBe(true);
  });
});

describe("estimateCost", () => {
  it("charges a list field for its whole subtree", () => {
    const one = estimateCost(schema, parse(`{ board(id: 1) { columns { id } } }`));
    const two = estimateCost(schema, parse(`{ board(id: 1) { columns { id title } } }`));
    // The second field is not +1: it is paid once per column.
    expect(two - one).toBeGreaterThan(1);
  });

  it("charges a root field more than a leaf — it is a repository call", () => {
    expect(estimateCost(schema, parse(`{ board(id: 1) { id } }`))).toBeGreaterThan(2);
  });
});
