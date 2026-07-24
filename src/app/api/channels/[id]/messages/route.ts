import { messages, post } from "@/features/chat/server/handlers";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return messages(request,(await params).id);}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return post(request,(await params).id);}
