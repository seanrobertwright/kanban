import { dm } from "@/features/chat/server/handlers";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return dm(request,(await params).id);}
