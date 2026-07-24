import { publicBoard } from "@/features/sharing/server/handlers";
export async function GET(request:Request,{params}:{params:Promise<{token:string}>}){return publicBoard(request,(await params).token);}
