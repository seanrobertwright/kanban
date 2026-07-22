/**
 * Request management (052, rock 1.8). A request is a Form (039) submission — a
 * task carrying request_meta. The Requests queue lists them with their status
 * (column), the form they came through, who filed them, and their nearest open
 * SLA due time, so an intake team works the backlog of incoming work.
 */
export interface RequestItem {
  id: number;
  title: string;
  /** The task's column — its request status. */
  status: string;
  columnId: number;
  /** The form the request came through. */
  source: string;
  requesterName: string | null;
  /** The nearest open SLA due time, or null if untimed. */
  slaDueAt: string | null;
  createdAt: string;
}
