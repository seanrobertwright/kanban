import { describe, expect, it } from "vitest";

import type { Snapshot } from "../lib/engine";
import { runScript } from "./sandbox";

/**
 * Custom scripts (rock 1.11) — the sandbox is pure (no DB): it computes effect
 * descriptors from a task snapshot, and everything here is safety-critical, so it
 * is tested hard — valid effects through, invalid/nested-script dropped, no Node
 * globals, and a runaway loop stopped by the timeout.
 */
describe("runScript (sandbox)", () => {
  const task: Snapshot = { priority: "urgent", columnId: 3, title: "boom" };

  it("returns the effects a script emits", () => {
    const effects = runScript(
      `if (task.priority === 'urgent') return [{ type: 'comment', body: 'escalated' }];
       return [];`,
      task
    );
    expect(effects).toEqual([{ type: "comment", body: "escalated" }]);
  });

  it("drops invalid effects and nested scripts", () => {
    const effects = runScript(
      `return [
         { type: 'comment', body: 'ok' },
         { type: 'script', code: 'return []' },
         { type: 'bogus' },
         { type: 'move' }
       ];`,
      task
    );
    expect(effects).toEqual([{ type: "comment", body: "ok" }]);
  });

  it("has no access to Node globals (process/require)", () => {
    const effects = runScript(
      `return [{ type: 'comment', body: typeof process + ',' + typeof require }];`,
      task
    );
    expect(effects[0]).toEqual({ type: "comment", body: "undefined,undefined" });
  });

  it("cannot mutate the caller's snapshot (frozen — throws, original intact)", () => {
    expect(() => runScript(`task.title = 'hacked'; return [];`, task)).toThrow();
    expect(task.title).toBe("boom");
  });

  it("stops a runaway loop at the timeout", () => {
    expect(() => runScript(`while (true) {}`, task)).toThrow();
  });

  it("a non-array return yields no effects", () => {
    expect(runScript(`return 42;`, task)).toEqual([]);
  });
});
