"use client";

import { useState } from "react";
import { Building2, Loader2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { authClient } from "../client/auth-client";

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-4">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.24 2.76.12 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.35.77 1.05.77 2.12v3.14c0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

export function SignInCard() {
  const [pending, setPending] = useState(false);
  const [ssoOpen, setSsoOpen] = useState(false);
  const [ssoEmail, setSsoEmail] = useState("");
  const [ssoPending, setSsoPending] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    try {
      await authClient.signIn.social({ provider: "github", callbackURL: "/" });
    } catch {
      setPending(false);
    }
  }

  async function signInSSO(event: React.FormEvent) {
    event.preventDefault();
    const email = ssoEmail.trim();
    if (!email || ssoPending) return;
    setSsoPending(true);
    setSsoError(null);
    // The server's sso plugin resolves the email's domain to a registered
    // provider and answers { url, redirect } — the client's redirect plugin
    // then navigates for us. Only failures leave this branch.
    const { error } = await authClient.signIn.sso({ email, callbackURL: "/" });
    if (error) {
      setSsoPending(false);
      setSsoError(
        error.status === 404
          ? `No SSO provider is registered for ${email.split("@")[1] ?? "that domain"}. Ask your workspace owner to set one up, or sign in with GitHub.`
          : (error.message ?? "SSO sign-in failed. Try again.")
      );
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Use your GitHub account or your company&apos;s identity provider.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Button className="w-full" onClick={signIn} disabled={pending}>
          <GitHubIcon /> {pending ? "Redirecting…" : "Continue with GitHub"}
        </Button>

        {!ssoOpen ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setSsoOpen(true)}
          >
            <Building2 className="size-4" /> Sign in with SSO
          </Button>
        ) : (
          <form onSubmit={signInSSO} className="grid gap-2 border-t pt-3">
            <Label htmlFor="sso-email">Work email</Label>
            <Input
              id="sso-email"
              type="email"
              value={ssoEmail}
              onChange={(e) => setSsoEmail(e.target.value)}
              placeholder="you@company.com"
              autoFocus
            />
            {ssoError && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {ssoError}
              </p>
            )}
            <Button
              type="submit"
              variant="outline"
              className="w-full"
              disabled={ssoPending || !ssoEmail.trim()}
            >
              {ssoPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Continue with SSO"
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
