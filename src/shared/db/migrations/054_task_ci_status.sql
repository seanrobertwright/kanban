-- CI/CD integration (054, rock 2.7) — build/deploy/pipeline status on the task.
--
-- The link model (2.0) tracks the branch/PR/commit that delivers a task. A CI run
-- is a different shape: it is *about* a ref (a branch or sha), it has a two-part
-- lifecycle (a status that runs queued → in_progress → completed, and only then a
-- conclusion of success/failure), and it re-reports as it progresses. So it gets
-- its own table rather than overloading task_git_link.state, whose three PR values
-- (open/merged/closed) mean something else.
--
-- Task resolution is 2.0's, reused: a check_suite/pipeline event names its ref
-- (head_branch / pipeline ref), and a `feature/123-slug` branch resolves to task
-- 123 the same way a commit's branch does. The ingest logs git.ci_passed /
-- git.ci_failed on the transition to a terminal conclusion, so "when CI fails,
-- notify the assignee" is an ordinary Phase-1 rule — no second bus, exactly like
-- every other git event.
CREATE TABLE IF NOT EXISTS task_ci_status (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  -- Provenance; SET NULL so disconnecting a repo un-ties the historical run rather
  -- than destroying the record (task_git_link.connection_id's rule).
  connection_id INTEGER REFERENCES repo_connection(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  -- The check_suite id / pipeline id — the provider's own id for the run, TEXT
  -- because it is not always a number and to match task_git_link.external_id.
  external_id TEXT NOT NULL,
  -- The branch or sha the run is for (what resolved it to the task).
  ref TEXT,
  -- The run lifecycle, provider-normalized: queued → in_progress → completed.
  status TEXT NOT NULL CHECK (status IN ('queued', 'in_progress', 'completed')),
  -- Set only once status is 'completed'. neutral covers skipped/cancelled — a
  -- terminal non-failure that is not a pass, so it fires no rule.
  conclusion TEXT CHECK (conclusion IN ('success', 'failure', 'neutral') OR conclusion IS NULL),
  url TEXT NOT NULL DEFAULT '',
  -- The workflow / pipeline name, if the provider names it.
  title TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The upsert key: a redelivered event for the same run updates in place, so a
  -- run that goes in_progress → completed is one row that changes state.
  UNIQUE (task_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_task_ci_status_task ON task_ci_status(task_id);
