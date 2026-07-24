import { query, queryOne } from "@/shared/db/client";
import { auth } from "@/features/auth/server/auth";
import { AuthzError, requireWorkspaceRole } from "@/features/workspaces/server/authz";

export async function listIdentityProviders(userId:string,workspaceId:string){
  await requireWorkspaceRole(userId,workspaceId,"admin");
  return query<{providerId:string;protocol:"oidc"|"saml";issuer:string;domain:string;createdAt:string}>(`SELECT w.provider_id AS "providerId",w.protocol,p."issuer",p."domain",w.created_at AS "createdAt" FROM workspace_identity_provider w JOIN "ssoProvider" p ON p."providerId"=w.provider_id WHERE w.workspace_id=$1 ORDER BY w.created_at`,[workspaceId]);
}
export async function registerIdentityProvider(userId:string,workspaceId:string,input:Record<string,unknown>,headers:Headers){
  await requireWorkspaceRole(userId,workspaceId,"owner");
  const providerId=typeof input.providerId==="string"?input.providerId:"";
  const protocol=input.samlConfig?"saml":input.oidcConfig?"oidc":null;
  if(!/^[a-z0-9][a-z0-9-]{2,63}$/.test(providerId)||!protocol)throw new AuthzError("conflict","Provider id and either OIDC or SAML configuration are required");
  const existing=await queryOne<{providerId:string}>(`SELECT provider_id AS "providerId" FROM workspace_identity_provider WHERE provider_id=$1`,[providerId]); if(existing)throw new AuthzError("conflict","Provider id is already owned by a workspace");
  // Better Auth owns protocol validation and writes secrets only to its plugin table.
  await auth.api.registerSSOProvider({ body: input as never, headers });
  await query(`INSERT INTO workspace_identity_provider(workspace_id,provider_id,protocol,created_by) VALUES($1,$2,$3,$4)`,[workspaceId,providerId,protocol,userId]);
}
export async function removeIdentityProvider(userId:string,workspaceId:string,providerId:string,headers:Headers){
  await requireWorkspaceRole(userId,workspaceId,"owner");
  const owned=await queryOne<{providerId:string}>(`SELECT provider_id AS "providerId" FROM workspace_identity_provider WHERE workspace_id=$1 AND provider_id=$2`,[workspaceId,providerId]);if(!owned)throw new AuthzError("not_found","Identity provider not found");
  // A removed SSO provider must not leave a live bearer token able to keep
  // provisioning accounts. The SCIM plugin owns token invalidation.
  const scimConnection = await queryOne<{ providerId: string }>(
    `SELECT "providerId" FROM "scimProvider" WHERE "providerId" = $1`,
    [providerId]
  );
  if (scimConnection) {
    await auth.api.deleteSCIMProviderConnection({ body: { providerId }, headers });
  }
  await auth.api.deleteSSOProvider({body:{providerId},headers});
  await query(`DELETE FROM workspace_identity_provider WHERE workspace_id=$1 AND provider_id=$2`,[workspaceId,providerId]);
}
export async function generateScimToken(userId:string,workspaceId:string,providerId:string,headers:Headers){
  await requireWorkspaceRole(userId,workspaceId,"owner");
  const owned=await queryOne<{providerId:string}>(`SELECT provider_id AS "providerId" FROM workspace_identity_provider WHERE workspace_id=$1 AND provider_id=$2`,[workspaceId,providerId]);if(!owned)throw new AuthzError("not_found","Identity provider not found");
  return auth.api.generateSCIMToken({body:{providerId},headers});
}
