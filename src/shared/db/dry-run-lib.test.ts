import { describe, expect, it } from "vitest";

import { isReadOnlySql, projectAfter } from "./dry-run";

/**
 * The two pure halves of a dry run (§4.4 item 9): the guard that decides whether
 * a statement writes, and the projection that says what the caller asked for.
 *
 * The guard is the load-bearing one. It is what turns "nothing was written" from
 * a promise each seam has to keep into a property the pool enforces, so a gap in
 * it is not a wrong answer — it is a mutation reported as a plan.
 */

describe("isReadOnlySql", () => {
  it("accepts the read shapes the repositories actually use", () => {
    expect(isReadOnlySql(`SELECT * FROM task WHERE id = $1`)).toBe(true);
    expect(isReadOnlySql(`  \n  SELECT 1`)).toBe(true);
    expect(
      isReadOnlySql(`WITH ancestors AS (SELECT id FROM task) SELECT * FROM ancestors`)
    ).toBe(true);
    expect(isReadOnlySql(`(SELECT 1) UNION (SELECT 2)`)).toBe(true);
  });

  it("refuses every statement that writes", () => {
    expect(isReadOnlySql(`INSERT INTO task (title) VALUES ($1)`)).toBe(false);
    expect(isReadOnlySql(`UPDATE task SET title = $1 WHERE id = $2`)).toBe(false);
    expect(isReadOnlySql(`DELETE FROM task WHERE id = $1`)).toBe(false);
    expect(isReadOnlySql(`TRUNCATE task`)).toBe(false);
    expect(isReadOnlySql(`ALTER TABLE task ADD COLUMN x int`)).toBe(false);
  });

  // The case a first-keyword test would wave straight through: the statement
  // starts with WITH and deletes a row.
  it("refuses a data-modifying CTE", () => {
    expect(
      isReadOnlySql(
        `WITH gone AS (DELETE FROM task WHERE id = $1 RETURNING id) SELECT * FROM gone`
      )
    ).toBe(false);
  });

  // The case a keyword-anywhere test would break on, and it is not hypothetical:
  // this schema logs activity actions as literal strings, so half the SELECTs in
  // the app contain the word "update" inside quotes.
  it("is not fooled by a write verb inside a string literal or an identifier", () => {
    expect(
      isReadOnlySql(`SELECT * FROM activity_log WHERE action = 'task.update'`)
    ).toBe(true);
    expect(
      isReadOnlySql(`SELECT * FROM activity_log WHERE action IN ('task.delete', 'task.create')`)
    ).toBe(true);
    expect(isReadOnlySql(`SELECT t."update" FROM task t`)).toBe(true);
    // An escaped quote inside a literal must not unbalance the stripping and
    // leave the rest of the statement looking like SQL.
    expect(isReadOnlySql(`SELECT 'it''s fine' AS x`)).toBe(true);
  });

  it("treats a locking read as a read", () => {
    expect(isReadOnlySql(`SELECT * FROM task WHERE id = $1 FOR UPDATE`)).toBe(true);
    expect(isReadOnlySql(`SELECT 1 FOR NO KEY UPDATE`)).toBe(true);
    expect(isReadOnlySql(`SELECT 1 FOR SHARE`)).toBe(true);
  });

  it("ignores comments rather than reading keywords out of them", () => {
    expect(isReadOnlySql(`-- UPDATE task\nSELECT 1`)).toBe(true);
    expect(isReadOnlySql(`/* DELETE FROM task */ SELECT 1`)).toBe(true);
  });

  // The direction the gap has to fail in: an unrecognised statement costs a
  // refused dry run, never an applied one.
  it("refuses anything it does not recognise", () => {
    expect(isReadOnlySql(`GRANT ALL ON task TO admin`)).toBe(false);
    expect(isReadOnlySql(`BEGIN`)).toBe(false);
    expect(isReadOnlySql(``)).toBe(false);
  });
});

describe("projectAfter", () => {
  const task = {
    id: 7,
    title: "Ship it",
    priority: "low",
    columnId: 3,
    dueDate: null as string | null,
    labelIds: [1, 2],
    assignee: { type: "human", id: "u1" },
  };

  it("applies the caller's fields and names only what differs", () => {
    const { after, changed, unprojected } = projectAfter(task, {
      id: 7,
      priority: "high",
      title: "Ship it",
    });
    expect(after).toMatchObject({ priority: "high", title: "Ship it", columnId: 3 });
    // title was sent but is identical, so it is not a change.
    expect(changed).toEqual(["priority"]);
    expect(unprojected).toEqual([]);
  });

  it("reports a three-valued clear as a change", () => {
    const { after, changed } = projectAfter(
      { ...task, dueDate: "2026-08-01" },
      { dueDate: null }
    );
    expect((after as Record<string, unknown>).dueDate).toBeNull();
    expect(changed).toEqual(["dueDate"]);
  });

  // `!==` would call every unchanged array and object a change, which would make
  // a no-op label write read as a real edit on every call.
  it("compares arrays and objects structurally", () => {
    expect(projectAfter(task, { labelIds: [1, 2] }).changed).toEqual([]);
    expect(projectAfter(task, { labelIds: [1, 3] }).changed).toEqual(["labelIds"]);
    expect(
      projectAfter(task, { assignee: { type: "human", id: "u1" } }).changed
    ).toEqual([]);
    expect(projectAfter(task, { assignee: null }).changed).toEqual(["assignee"]);
  });

  // A comment's body names no field of the task. Reporting `changed: []` alone
  // would read as "this does nothing"; `unprojected` is what says otherwise.
  it("collects input keys that name no field of the target", () => {
    const { changed, unprojected } = projectAfter(task, {
      taskId: 7,
      body: "Looks good",
    });
    expect(changed).toEqual([]);
    expect(unprojected).toEqual(["body"]);
  });

  // The handlers build patch objects that carry `priority: undefined` for every
  // two-valued field a PATCH did not mention — the repository reads their value,
  // not their presence. Merging those would report a title-only edit as changing
  // four fields, each of them to nothing. Found by the real-DB suite, not by
  // reasoning about it.
  it("ignores an explicit undefined, which is not something the caller said", () => {
    const { after, changed, unprojected } = projectAfter(task, {
      title: "Renamed",
      priority: undefined,
      description: undefined,
    });
    expect(changed).toEqual(["title"]);
    expect(unprojected).toEqual([]);
    expect((after as Record<string, unknown>).priority).toBe("low");
  });

  it("treats a create as its own after, with every field a change", () => {
    const { after, changed, unprojected } = projectAfter(null, {
      columnId: 3,
      title: "New",
    });
    expect(after).toEqual({ columnId: 3, title: "New" });
    expect(changed).toEqual(["columnId", "title"]);
    expect(unprojected).toEqual([]);
  });

  it("never reports the id the caller repeated back as an edit", () => {
    const both = projectAfter(task, { id: 7, taskId: 7, priority: "high" });
    expect(both.changed).toEqual(["priority"]);
    expect(both.unprojected).toEqual([]);
  });
});
