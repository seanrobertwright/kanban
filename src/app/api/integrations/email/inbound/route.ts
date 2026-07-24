import { handleInboundEmail } from "@/features/integrations/server/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) { return handleInboundEmail(request); }
