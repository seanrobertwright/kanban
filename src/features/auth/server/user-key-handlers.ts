import { getSessionFromRequest, unauthorized } from "./session";
import {
  createUserApiKey,
  deleteUserApiKey,
  listUserApiKeys,
} from "./user-key-admin";

/**
 * Route handlers for /api/user/api-keys.
 *
 * Session-only, on purpose: these call getSessionFromRequest directly rather
 * than getPrincipalFromRequest, so neither an agent key nor a personal API key
 * can reach them. A key must not mint keys — otherwise one leaked credential
 * becomes an unbounded supply and revoking the original no longer ends the
 * incident. The browser settings panel is the only caller.
 */

// A user with more keys than this has lost track of them; refuse the 21st
// rather than host an unbounded credential pile.
const MAX_KEYS = 20;

export async function handleListUserApiKeys(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  return Response.json(await listUserApiKeys(session.user.id));
}

export async function handleCreateUserApiKey(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const name =
    typeof (body as { name?: unknown })?.name === "string"
      ? (body as { name: string }).name.trim()
      : "";
  if (!name || name.length > 100) {
    return Response.json(
      { error: "name is required (1-100 characters)" },
      { status: 400 }
    );
  }

  const existing = await listUserApiKeys(session.user.id);
  if (existing.length >= MAX_KEYS) {
    return Response.json(
      { error: `You already have ${MAX_KEYS} keys. Revoke one before minting another.` },
      { status: 400 }
    );
  }

  const { key, token } = await createUserApiKey(session.user.id, name);
  // The token appears in this response and nowhere else, ever again.
  return Response.json({ ...key, token }, { status: 201 });
}

export async function handleDeleteUserApiKey(request: Request, keyId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return unauthorized();
  const deleted = await deleteUserApiKey(session.user.id, keyId);
  if (!deleted) {
    return Response.json({ error: "Key not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
