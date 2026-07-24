import { sharedBoard } from "@/features/sharing/server/handlers";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return sharedBoard(request,(await params).id);}
