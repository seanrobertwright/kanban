import { handlePublicDoc } from "@/features/docs/server/handlers";
export async function GET(request:Request,{params}:{params:Promise<{token:string}>}){return handlePublicDoc(request,(await params).token);}
