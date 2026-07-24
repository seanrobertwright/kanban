import { query } from "@/shared/db/client";

export async function sweepRetention(){
  // Audit events are append-only and self-contained; deleting only rows older
  // than an explicit workspace policy is safe. Other live object types wait for
  // their soft-delete lifecycle so retention never destroys active work.
  await query(`DELETE FROM activity_log a USING retention_policy p WHERE p.workspace_id=a.workspace_id AND p.subject_type='activity_log' AND a.created_at < now() - (p.max_age_days * interval '1 day')`);
}
export function startRetentionSweeper(){
  const run=()=>void sweepRetention().catch(error=>console.error("Retention sweep failed",error));
  run(); return setInterval(run,60*60*1000);
}
