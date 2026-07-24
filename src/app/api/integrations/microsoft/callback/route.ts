import { finishMicrosoftInstall } from "@/features/integrations/server/handlers";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return finishMicrosoftInstall(request); }
