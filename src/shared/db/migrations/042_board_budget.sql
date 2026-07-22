-- Budget / financial planning (042) — a project's money, tied to the board.
--
-- A board is a project; this gives it a budget and a labour rate so spend can be
-- tracked against it. Spend is not stored — it is derived from the time_entry
-- ledger (027): logged hours × the board's hourly rate. That keeps the financial
-- picture honest (it moves only when real work is logged) and needs no per-task
-- cost column, the way priority_score is derived from value/estimate rather than
-- stored (034).
--
-- Money is DOUBLE PRECISION, key_result's choice (037): a budget is a planning
-- figure displayed rounded, not a ledger balance, so a float carries it without a
-- per-currency scale decision. The three columns live on board rather than a side
-- table because there is exactly one budget per project.
ALTER TABLE board
  -- The project's budget. NULL is "no budget set" — three-valued, so the read can
  -- report spend without a budget to measure it against (remaining stays null).
  ADD COLUMN IF NOT EXISTS budget_amount DOUBLE PRECISION,
  -- Cost per logged hour. NOT NULL DEFAULT 0 — until a rate is set, logged time
  -- costs nothing, so spend is an honest 0 rather than null.
  ADD COLUMN IF NOT EXISTS hourly_rate DOUBLE PRECISION NOT NULL DEFAULT 0
    CHECK (hourly_rate >= 0),
  -- The display currency code ("USD", "EUR"). NOT NULL DEFAULT, two-valued.
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
