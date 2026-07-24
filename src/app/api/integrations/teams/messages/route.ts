import { handleTeamsActivity } from "@/features/integrations/server/teams";

export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleTeamsActivity(request); }
