import { create,list } from "@/features/whiteboards/server/handlers";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return list(request,(await params).id);}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return create(request,(await params).id);}
