import { createAuthClient } from "better-auth/react";
import { ssoClient } from "@better-auth/sso/client";

// ssoClient adds signIn.sso(), the browser half of the server's sso() plugin.
// The server resolves an email's domain to a registered provider itself, so the
// client needs no lookup route — just this method.
export const authClient = createAuthClient({ plugins: [ssoClient()] });
