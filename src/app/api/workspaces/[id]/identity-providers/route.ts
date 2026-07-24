import { listProviders, registerProvider } from "@/features/admin/server/handlers";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return listProviders(request,id);}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;return registerProvider(request,id);}
