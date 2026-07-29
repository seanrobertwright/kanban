-- Durable CRDT state for whiteboards (code-review §2.1, `whiteboards`: "single
-- writer last-write-wins; CRDT transport exists but unwired").
--
-- 060 stored a canvas as one JSONB array and the dialog PATCHed the whole array
-- on a 500ms debounce. Two people drawing at once is therefore not a merge but a
-- race: whoever's debounce fires last writes their own view of the scene over
-- the other's, and the loser's shapes are gone with no error anywhere. 057 built
-- the fix for exactly this shape — an append-cheap update log compacted into a
-- snapshot when the last collaborator leaves — for docs, and nothing pointed it
-- at whiteboards. These are that pair of tables for the second subject.
--
-- Separate tables rather than a `subject_type` column on the doc pair: the FKs
-- are the point. `ON DELETE CASCADE` from `whiteboard(id)` is what keeps a
-- deleted canvas from leaving megabytes of Yjs history behind, and a polymorphic
-- subject_id cannot carry a foreign key at all.
--
-- `whiteboard.scene` stays the source of truth for every reader that is not in
-- the room — the dialog's first paint, exports, agents, a deployment with no
-- realtime process at all — so the socket service flattens the CRDT back into it
-- when the room empties. That leaves one honest conflict: a REST PATCH landing
-- while a room is live is overwritten when the room closes. The service resolves
-- the reverse case (a PATCH while nobody is in the room) by timestamp at room
-- open, and this direction is left alone deliberately, since the only client
-- that PATCHes is the same dialog that would be holding the socket if one were
-- available.
CREATE TABLE whiteboard_yjs_snapshot (
  whiteboard_id INTEGER PRIMARY KEY REFERENCES whiteboard(id) ON DELETE CASCADE,
  state BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE whiteboard_yjs_update (
  id BIGSERIAL PRIMARY KEY,
  whiteboard_id INTEGER NOT NULL REFERENCES whiteboard(id) ON DELETE CASCADE,
  update BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_whiteboard_yjs_update_board ON whiteboard_yjs_update(whiteboard_id, id);
