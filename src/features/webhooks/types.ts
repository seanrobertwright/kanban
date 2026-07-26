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

/**
 * One event's journey to one subscriber (082).
 *
 * The webhook row's lastStatus answers "is this endpoint healthy"; this answers
 * "did *that* event get through, and if not, why" — which is the question an
 * admin actually has after an outage, and the one a single overwritten status
 * column can never answer.
 */
export interface WebhookDelivery {
  id: string;
  /** The ActivityAction name, copied so the record outlives retention sweeps. */
  action: string;
  attempts: number;
  /** The last attempt's HTTP status; 0 means the endpoint was unreachable. */
  lastStatus: number | null;
  lastError: string | null;
  /** `pending` is still queued, `failed` is written off, `delivered` is done. */
  status: "pending" | "delivered" | "failed";
  nextAttemptAt: string;
  createdAt: string;
}
