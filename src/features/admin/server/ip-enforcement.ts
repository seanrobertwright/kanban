import { headers } from "next/headers";
import { query } from "@/shared/db/client";
import { isIpAllowed } from "./ip";
export class NetworkAccessError extends Error {}

/** Enable only after the edge proxy is configured to overwrite the selected
 * header. Empty/disabled is deliberately open, preserving current deployments. */
export async function enforceWorkspaceNetwork(workspaceId:string){
  if(process.env.IP_ALLOWLIST_ENFORCEMENT!=="1")return;
  const header=process.env.TRUSTED_CLIENT_IP_HEADER;
  if(header!=="x-forwarded-for"&&header!=="x-real-ip")throw new NetworkAccessError("IP allowlist is enabled without a trusted client-IP header");
  const entries=await query<{cidr:string}>(`SELECT cidr FROM ip_allowlist WHERE workspace_id=$1`,[workspaceId]); if(!entries.length)return;
  const value=(await headers()).get(header); const ip=header==="x-forwarded-for"?value?.split(",")[0]?.trim():value?.trim();
  if(!ip||!isIpAllowed(ip,entries.map(e=>e.cidr)))throw new NetworkAccessError("Network access denied");
}
