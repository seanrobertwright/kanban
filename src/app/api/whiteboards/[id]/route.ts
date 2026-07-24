import { update } from "@/features/whiteboards/server/handlers";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){return update(request,(await params).id);}
