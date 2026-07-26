import { seen } from "@/features/chat/server/handlers";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return seen(request,(await params).id);}
