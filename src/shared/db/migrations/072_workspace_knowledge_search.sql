-- Workspace Q&A (4.3) uses PostgreSQL full-text retrieval over the three
-- authorized source classes. Expression indexes keep citation retrieval fast
-- without duplicating workspace content into a second search store.
CREATE INDEX IF NOT EXISTS idx_task_knowledge_search
  ON task USING GIN (to_tsvector('simple', title || ' ' || COALESCE(description, '')));

CREATE INDEX IF NOT EXISTS idx_comment_knowledge_search
  ON comment USING GIN (to_tsvector('simple', body));

CREATE INDEX IF NOT EXISTS idx_doc_knowledge_search
  ON doc USING GIN (to_tsvector('simple', title || ' ' || body))
  WHERE is_published;
