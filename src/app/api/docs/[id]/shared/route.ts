import { handleSharedDoc } from "@/features/docs/server/handlers";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return handleSharedDoc(request,(await params).id);}
