import { taskPanels } from "@/features/extensions/server/handlers";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return taskPanels(request,Number(id));}
