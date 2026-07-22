import { handleFireTrigger } from "@/features/automations/server/handlers";

// The inbound driver (1.12): an external tool POSTs its board trigger token here
// to fire the board's external.trigger rules. No session — the token authorizes.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; token: string }> }
) {
  const { id, token } = await params;
  return handleFireTrigger(request, id, token);
}
