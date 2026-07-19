/**
 * An outbound webhook (025) — the activity stream crossing the process
 * boundary. The secret never rides this shape: the list read omits it, and
 * creation returns it once beside the row (the agent-token convention).
 */
export interface Webhook {
  id: number;
  workspaceId: string;
  url: string;
  /** Actions to deliver; empty means all. The names are ActivityAction's. */
  events: string[];
  active: boolean;
  createdAt: string;
  /** Last delivery's HTTP status, or null before the first attempt. */
  lastStatus: number | null;
  lastDeliveryAt: string | null;
}
