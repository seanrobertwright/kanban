-- M2: the per-workspace agent budget cap — §7.3's "non-negotiable" guardrail.
--
-- §7.3: "Per-workspace budget caps and metering are a product requirement, not
-- an afterthought. A runaway agent loop is a financial incident." Acceptance #5
-- (§9): "Exceeding the workspace budget cap halts the run cleanly." This column
-- is the cap; the run loop (017) reads it mid-loop and halts to 'halted'.
--
-- In MICRO-DOLLARS, the same unit agent_run.cost_micros uses (013), so the cap
-- comparison is a bare integer compare with no conversion. NULL = uncapped, which
-- is the honest default until pricing is decided: §12 Q1 leaves the price point
-- open to M6, and a number invented now would be a guess the meter exists to
-- replace. A workspace opts into a cap; it is not born with an arbitrary one.
--
-- Spend itself is NOT stored here. It is DERIVED by summing agent_run.cost_micros
-- over the window (features/agents/server/budget.ts) — M0's rule, "resolve by
-- query, never denormalize", because a running counter on the workspace row
-- would drift from the runs it is supposed to total the moment one write lands
-- and the other does not. The runs are the truth; the cap is the only new fact.
ALTER TABLE workspace
  ADD COLUMN IF NOT EXISTS agent_budget_micros BIGINT;
