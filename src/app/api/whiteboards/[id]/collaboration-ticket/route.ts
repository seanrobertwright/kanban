import { collaborationTicket } from "@/features/whiteboards/server/handlers";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return collaborationTicket(request,(await params).id);}
