-- Prioritisation scoring: rank work by value against effort and risk.
--
-- Two stored inputs, not three: effort is the story-point `estimate` already on
-- the task (022), so scoring builds on it rather than duplicating it. The score
-- itself is NOT stored — it is derived in taskColumns from value, estimate and
-- risk, the way subtaskCount and the checklist already are, so the formula lives
-- in code and can change without a migration.
--
--   priorityScore = value / (effort × (1 + risk/10))
--
-- Higher value raises it, higher effort lowers it, higher risk discounts it — a
-- WSJF-flavoured value-per-effort, risk-adjusted. Null until both value and a
-- non-zero estimate exist, because a value-per-effort with no effort is undefined.
ALTER TABLE task
  -- Relative business value on a 0–10 scale, or NULL for unscored. Bounded (unlike
  -- estimate's open-ended points) because a score needs a comparable ceiling: an
  -- 8 means something only against a fixed range. 0 is a real value ("no value"),
  -- so NULL alone means unscored — dueDate's three-valued shape on update.
  ADD COLUMN IF NOT EXISTS value INTEGER CHECK (value BETWEEN 0 AND 10),
  -- Relative risk / uncertainty, same 0–10 scale and same NULL-means-unset rule.
  -- Feeds the denominator: a 10 halves the score, a 0 leaves it untouched.
  ADD COLUMN IF NOT EXISTS risk INTEGER CHECK (risk BETWEEN 0 AND 10);
