-- Better Auth SCIM stores the IdP connection as an account whose providerId is
-- the configured SSO provider id. Keep that durable identity link and Kanban's
-- own workspace membership in the same database lifecycle.
CREATE OR REPLACE FUNCTION sync_scim_workspace_member_from_account()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM workspace_member m
     USING workspace_identity_provider p
     WHERE p.provider_id = OLD."providerId"
       AND p.workspace_id = m.workspace_id
       AND m.user_id = OLD."userId"
       AND NOT EXISTS (
         SELECT 1
           FROM "account" a
           JOIN workspace_identity_provider remaining
             ON remaining.provider_id = a."providerId"
          WHERE a."userId" = OLD."userId"
            AND remaining.workspace_id = m.workspace_id
            AND a.id <> OLD.id
       );
    RETURN OLD;
  END IF;

  INSERT INTO workspace_member (workspace_id, user_id, role)
  SELECT p.workspace_id, NEW."userId", 'member'::workspace_role
    FROM workspace_identity_provider p
   WHERE p.provider_id = NEW."providerId"
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_scim_workspace_member_on_account ON "account";
CREATE TRIGGER sync_scim_workspace_member_on_account
AFTER INSERT OR DELETE ON "account"
FOR EACH ROW EXECUTE FUNCTION sync_scim_workspace_member_from_account();

-- SCIM PATCH/PUT active=false maps to Better Auth's admin-plugin banned state.
-- Banned users keep their account link for a later reactivation, but must lose
-- workspace access immediately; active=true restores the default member role.
CREATE OR REPLACE FUNCTION sync_scim_workspace_member_from_user_ban()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.banned IS NOT DISTINCT FROM OLD.banned THEN
    RETURN NEW;
  ELSIF NEW.banned THEN
    DELETE FROM workspace_member m
     USING "account" a, workspace_identity_provider p
     WHERE a."userId" = NEW.id
       AND p.provider_id = a."providerId"
       AND m.workspace_id = p.workspace_id
       AND m.user_id = NEW.id;
  ELSE
    INSERT INTO workspace_member (workspace_id, user_id, role)
    SELECT DISTINCT p.workspace_id, NEW.id, 'member'::workspace_role
      FROM "account" a
      JOIN workspace_identity_provider p ON p.provider_id = a."providerId"
     WHERE a."userId" = NEW.id
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_scim_workspace_member_on_user_ban ON "user";
CREATE TRIGGER sync_scim_workspace_member_on_user_ban
AFTER UPDATE OF banned ON "user"
FOR EACH ROW EXECUTE FUNCTION sync_scim_workspace_member_from_user_ban();
