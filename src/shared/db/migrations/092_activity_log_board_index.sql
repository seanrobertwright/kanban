-- The change feed (code review §4.4 item 8) reads the activity log the one way
-- nothing else does: forward, by board, from a cursor.
--
-- 003 indexed (task_id, id DESC) and (workspace_id, id DESC) because both
-- readers are "newest first for one subject". A poller is the opposite shape —
-- `board_id = $1 AND id > $2 ORDER BY id ASC` — and neither existing index
-- serves it: the workspace one has the wrong leading column for a board filter
-- on a multi-board workspace, and both are descending, so the scan would read
-- the whole board's history backwards to find the newest rows.
--
-- Ascending, deliberately: a backwards index can serve a forward scan, but the
-- range predicate `id > cursor` is a prefix of an ascending index and a suffix
-- of a descending one, and the poll runs every second per connected agent.
CREATE INDEX IF NOT EXISTS idx_activity_log_board
  ON activity_log(board_id, id);
