import { handlePromoteMeetingAction } from "@/features/docs/server/handlers";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return handlePromoteMeetingAction(request,(await params).id);}
