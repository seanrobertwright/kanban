import { getPrincipalFromRequest } from "@/features/auth/server/agent-auth";
import { unauthorized } from "@/features/auth/server/session";
import { executeGraphQL } from "./schema";

/**
 * The GraphQL ingress (2.9). Auth is the shared principal resolution — a session
 * cookie or an x-agent-key, exactly what every other authenticated route uses — so
 * no principal at all is a 401. A bad query body is a 400; anything else returns
 * 200 with the standard `{ data, errors }`, the GraphQL convention (a field-level
 * authz failure is an `errors` entry, not an HTTP error).
 */
export async function handleGraphQL(request: Request) {
  const principal = await getPrincipalFromRequest(request);
  if (!principal) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as { query?: unknown }).query !== "string") {
    return Response.json({ errors: [{ message: "A GraphQL query is required" }] }, { status: 400 });
  }
  const { query, variables } = body as {
    query: string;
    variables?: Record<string, unknown> | null;
  };

  const result = await executeGraphQL(principal, query, variables);
  return Response.json(result);
}
