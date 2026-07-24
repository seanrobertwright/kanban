import { handleExtractMeetingActions } from "@/features/docs/server/handlers";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return handleExtractMeetingActions(request,(await params).id);}
