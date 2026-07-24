import { handleSlackEvent } from "@/features/integrations/server/slack";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleSlackEvent(request); }
