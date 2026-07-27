-- Workspace Q&A retrieval (4.3), second pass.
--
-- 072 indexed the three source classes with `to_tsvector('simple', …)`. That
-- shipped three weaknesses the answers paid for:
--
--   * 'simple' does no stemming, so "deploys" missed a doc saying "deploy" and
--     every stop word counted as a term worth matching.
--   * The reader ordered by `updated_at DESC` — recency, not relevance — so a
--     freshly-touched task outranked the document that actually answered.
--   * The tsvector was recomputed per row at query time. The 072 expression
--     indexes only helped when the reader's expression matched byte for byte,
--     which made the index a hostage to the query text.
--
-- This replaces the expressions with STORED generated columns (one source of
-- truth, computed on write, indexable without the matching-expression trap) on
-- the 'english' configuration, and adds trigram indexes for the fuzzy fallback
-- the reader uses when strict full-text finds nothing — a typo or a partial
-- name should still reach its task rather than returning "no sources".
--
-- pg_trgm is a trusted extension on PostgreSQL 13+, so the database owner can
-- create it without superuser.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE task
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', title || ' ' || COALESCE(description, ''))
  ) STORED;

ALTER TABLE comment
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', body)) STORED;

ALTER TABLE doc
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED;

CREATE INDEX IF NOT EXISTS idx_task_search_tsv ON task USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_comment_search_tsv ON comment USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_doc_search_tsv ON doc USING GIN (search_tsv)
  WHERE is_published;

-- The fuzzy arm. Titles only: a trigram index over a whole document body is
-- large and answers a question ("is this word roughly in here?") full text
-- already answers better. The fallback exists for misspelled names.
CREATE INDEX IF NOT EXISTS idx_task_title_trgm ON task USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_doc_title_trgm ON doc USING GIN (title gin_trgm_ops)
  WHERE is_published;

-- The 072 expression indexes are now dead weight: nothing queries 'simple'.
DROP INDEX IF EXISTS idx_task_knowledge_search;
DROP INDEX IF EXISTS idx_comment_knowledge_search;
DROP INDEX IF EXISTS idx_doc_knowledge_search;
