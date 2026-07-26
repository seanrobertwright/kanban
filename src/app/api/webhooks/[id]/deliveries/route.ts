import { handleListDeliveries } from "@/features/webhooks/server/handlers";

export const dynamic = "force-dynamic";

/** `GET /api/webhooks/:id/deliveries` — which events this endpoint actually
 *  received, and what went wrong for the ones it did not (082). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleListDeliveries(request, id);
}
