-- Public feedback portal (SPEC 3.10 — "a public feedback form + a public roadmap
-- are the highest-value shares").
--
-- 061 built the whole capability: unguessable tokens, a scope, an expiry, a
-- revoke, and a rate-limited anonymous path. Forms took it up; feedback intake
-- (043) never did, so the one place a product team most wants a link — "tell us
-- what you think" — had no link to mint.
--
-- The only schema this needs is one more subject type. subject_id for a
-- 'feedback' link is a BOARD id, not a feedback row: the link is a door into a
-- board's discovery inbox, and there is nothing to point at before the visitor
-- has written anything. That is why the type is not simply reusing 'board' with
-- scope='submit' — a board already means the read-only public board page, and
-- one subject that means two different pages depending on scope is the kind of
-- overload that eventually resolves the wrong one.

ALTER TABLE public_link DROP CONSTRAINT IF EXISTS public_link_subject_type_check;
ALTER TABLE public_link
  ADD CONSTRAINT public_link_subject_type_check
  CHECK (subject_type IN ('board', 'doc', 'form', 'view', 'feedback'));
