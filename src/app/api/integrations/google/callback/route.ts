import { finishGoogleInstall } from "@/features/integrations/server/handlers";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return finishGoogleInstall(request); }
