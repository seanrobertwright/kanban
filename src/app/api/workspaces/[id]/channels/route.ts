import { channels, create } from "@/features/chat/server/handlers";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return channels(request,(await params).id);}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return create(request,(await params).id);}
