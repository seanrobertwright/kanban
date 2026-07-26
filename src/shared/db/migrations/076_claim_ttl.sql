-- Claim lease TTL — a hold that can expire, so a crashed agent cannot wedge a
-- task forever.
--
-- 010 made the claim an exclusive hold and named its failure mode in the same
-- breath: "an agent that crashes mid-run leaves a hold nothing will ever drop",
-- answered then only by an admin breaking it by hand. That answer does not
-- scale past one stuck task a week. So the claim becomes a *lease*: it carries
-- an expiry, claimTask stamps one (default 60 minutes), a holder re-claiming
-- renews it, and a hold past its expiry is claimable by anyone with the rank —
-- taking over an expired lease is not breaking a hold, it is the lease working.
--
-- Nullable, deliberately: a pre-076 claim has no expiry and keeps meaning what
-- it meant ("held until released"), so no data backfill rewrites history. Every
-- claim taken after this migration gets an expiry from claimTask; the NULL case
-- exists only for rows that predate the lease and for the release path, which
-- nulls all four columns together.
ALTER TABLE task
  ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;

-- The 010 coherence rule, extended: an expiry is part of a claim, so it may be
-- set only while a claim exists. Not the full "all four move together" — the
-- pre-076 rows above are claims without expiry, and that is a legal state — but
-- an expiry without a claim is not a fact about anything, and the CHECK says so.
DO $$ BEGIN
  ALTER TABLE task ADD CONSTRAINT task_claim_expiry_coherent CHECK (
    claim_expires_at IS NULL OR claimed_by IS NOT NULL
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
