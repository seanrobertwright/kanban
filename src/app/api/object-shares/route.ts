import { grant,listShares,ungrant } from "@/features/sharing/server/handlers";
export async function GET(request:Request){return listShares(request);}
export async function POST(request:Request){return grant(request);}
export async function DELETE(request:Request){return ungrant(request);}
