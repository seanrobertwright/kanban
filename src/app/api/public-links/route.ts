import { mint } from "@/features/sharing/server/handlers";
export async function POST(request:Request){return mint(request);}
