-- Kanban WIP limits, per column.
--
-- A limit is advice made visible, not a wall: the column shows its count
-- against the limit and turns loud when over, but the database does not refuse
-- the move. That is the deliberate reading of kanban practice — a WIP limit
-- exists to start a conversation about flow, and a hard refusal would just
-- teach people to raise the limit. It also keeps moveTask's transaction free of
-- a count-and-check race that would need FOR UPDATE on the column for a rule
-- the team can change in the next breath.
--
-- NULL is "no limit", unavoidably — there is no count that means unlimited, 0
-- least of all (a frozen column is a real practice). So the field is
-- three-valued on update, dueDate's shape. CHECK > 0 because a limit of zero
-- reads as "this column accepts nothing", which is a column policy (state
-- transition rules), not a WIP limit — refusing it here keeps the two ideas
-- from blurring.
ALTER TABLE board_column
  ADD COLUMN IF NOT EXISTS wip_limit INTEGER CHECK (wip_limit > 0);
