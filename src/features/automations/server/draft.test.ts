import { beforeEach, describe, expect, it } from "vitest";

import { draftRule, type DraftContext } from "./draft";

/**
 * Rock 4.4's claim is "the model proposes, the schema decides". These cases pin
 * the deciding half: what the model returns is a proposal that must survive the
 * compiler, the API's own validators, and the board's real ids — and what
 * survives is always disabled. The model call is injected, so nothing here can
 * reach the network; `ANTHROPIC_API_KEY` is cleared besides, so an un-injected
 * case falls to the phrasebook rather than dialling out.
 */

const context: DraftContext = {
  columns: [
    { id: 7, title: "Done" },
    { id: 3, title: "In Progress" },
  ],
  labels: [{ id: 11, name: "urgent" }],
  members: [{ id: "user-dana", name: "Dana" }],
};

/** The DTO shape the model is asked to fill — not the engine's. */
function proposal(over: Record<string, unknown> = {}) {
  return {
    name: "Ship it",
    event: "git.pr_merged",
    every: null,
    conditions: [{ field: "type", op: "eq", value: "bug" }],
    actions: [{ type: "move", columnId: 7 }],
    ...over,
  };
}

const propose = (value: unknown) => () => Promise.resolve(value);

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("draftRule", () => {
  it("compiles a model proposal into a disabled, validated rule", async () => {
    const result = await draftRule("when a PR merges move it to done", context, {
      propose: propose(
        proposal({
          actions: [
            { type: "move", columnId: 7 },
            { type: "assign", memberId: "user-dana" },
            { type: "add_label", labelId: 11 },
            { type: "notify", message: "merged" },
            { type: "create_task", title: "Verify in staging", columnId: null },
          ],
        })
      ),
    });

    expect(result).toMatchObject({
      source: "model",
      rule: {
        name: "Ship it",
        isEnabled: false,
        trigger: { event: "git.pr_merged" },
        conditions: { all: [{ field: "type", op: "eq", value: "bug" }] },
        actions: [
          { type: "move", columnId: 7 },
          // The DTO's memberId becomes the engine's Actor, not a bare string.
          { type: "assign", assignee: { type: "human", id: "user-dana" } },
          { type: "add_label", labelId: 11 },
          { type: "notify", target: "assignee", message: "merged" },
          { type: "create_task", title: "Verify in staging" },
        ],
      },
    });
    // A null columnId means "the board's default", not a create_task aimed at
    // column null — the key is absent, not present-and-nullish.
    const rule = (result as unknown as { rule: { actions: Record<string, unknown>[] } })
      .rule;
    expect("columnId" in rule.actions[4]).toBe(false);
  });

  it("refuses ids the board does not have rather than guessing a near one", async () => {
    const column = await draftRule("move it to done", context, {
      propose: propose(proposal({ actions: [{ type: "move", columnId: 999 }] })),
    });
    expect(column).toEqual({ error: expect.stringContaining("column") });

    const label = await draftRule("label it", context, {
      propose: propose(proposal({ actions: [{ type: "add_label", labelId: 999 }] })),
    });
    expect(label).toEqual({ error: expect.stringContaining("label") });

    const member = await draftRule("assign it to Sam", context, {
      propose: propose(proposal({ actions: [{ type: "assign", memberId: "ghost" }] })),
    });
    expect(member).toEqual({ error: expect.stringContaining("member") });
  });

  it("refuses an action the engine has no door for — scripts included", async () => {
    // `script` is a real engine action, deliberately absent from the DTO: a
    // model writing sandboxed code for a human to skim is the review that does
    // not happen.
    const scripted = await draftRule("run some code", context, {
      propose: propose(
        proposal({ actions: [{ type: "script", code: "task.title = 'x'" }] })
      ),
    });
    expect(scripted).toEqual({ error: expect.stringContaining("no door") });

    const invented = await draftRule("do a thing", context, {
      propose: propose(proposal({ actions: [{ type: "teleport", to: 1 }] })),
    });
    expect(invented).toEqual({ error: expect.stringContaining("no door") });
  });

  it("refuses an unknown trigger and a rule with nothing to do", async () => {
    expect(
      await draftRule("when the moon is full", context, {
        propose: propose(proposal({ event: "moon.full" })),
      })
    ).toEqual({ error: expect.stringContaining("known event") });

    expect(
      await draftRule("when a PR merges", context, {
        propose: propose(proposal({ actions: [] })),
      })
    ).toEqual({ error: expect.stringContaining("no actions") });
  });

  it("passes a schedule interval through and defaults a missing one", async () => {
    const daily = await draftRule("every day, comment on stale work", context, {
      propose: propose(
        proposal({
          event: "schedule.tick",
          every: "weekly",
          actions: [{ type: "comment", body: "still open?" }],
        })
      ),
    });
    expect(daily).toMatchObject({
      rule: { trigger: { event: "schedule.tick", every: "weekly" } },
    });

    const defaulted = await draftRule("on a schedule, comment", context, {
      propose: propose(
        proposal({
          event: "schedule.tick",
          every: null,
          actions: [{ type: "comment", body: "still open?" }],
        })
      ),
    });
    expect(defaulted).toMatchObject({
      rule: { trigger: { event: "schedule.tick", every: "daily" } },
    });
  });

  it("drops the value from a unary predicate and caps a long name", async () => {
    const result = await draftRule("when a task has no assignee", context, {
      propose: propose(
        proposal({
          name: "x".repeat(200),
          conditions: [{ field: "assignee.id", op: "isEmpty", value: null }],
        })
      ),
    });
    const rule = (result as {
      rule: { name: string; conditions: { all: Record<string, unknown>[] } };
    }).rule;
    // isEmpty is unary: a carried null would read as "equals null".
    expect(rule.conditions.all[0]).toEqual({ field: "assignee.id", op: "isEmpty" });
    expect(rule.name).toHaveLength(80);
  });

  it("falls back to the phrasebook when the model is absent or fails", async () => {
    const noModel = await draftRule("When a PR merges, move it to Done", context);
    expect(noModel).toMatchObject({
      source: "phrasebook",
      rule: { isEnabled: false, trigger: { event: "git.pr_merged" } },
    });

    const outage = await draftRule("When a PR merges, move it to Done", context, {
      propose: () => Promise.reject(new Error("503")),
    });
    expect(outage).toMatchObject({ source: "phrasebook" });

    // The phrasebook only knows a few sentences, and says so rather than
    // inventing a rule.
    expect(await draftRule("do something clever", context)).toEqual({
      error: expect.stringContaining("Could not turn that into a rule"),
    });
  });

  it("asks for a prompt it can work with", async () => {
    expect(await draftRule("   ", context)).toEqual({
      error: expect.stringContaining("Describe"),
    });
    expect(await draftRule("x".repeat(1001), context)).toEqual({
      error: expect.stringContaining("under 1000"),
    });
  });
});
