import { headers } from "next/headers";

import { auth } from "./auth";

/** Session lookup for server components (reads request headers via next). */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Session lookup for route handlers (headers come from the Request). */
export async function getSessionFromRequest(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
