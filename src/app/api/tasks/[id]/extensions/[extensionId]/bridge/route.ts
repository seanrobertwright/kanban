import { taskBridge } from "@/features/extensions/server/handlers";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string;extensionId:string}>}){const {id,extensionId}=await params;return taskBridge(request,Number(id),Number(extensionId));}
