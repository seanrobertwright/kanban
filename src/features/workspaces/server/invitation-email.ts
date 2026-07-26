import nodemailer from "nodemailer";

/**
 * Invitation delivery rides the same SMTP contract as the integrations mailer
 * (src/features/integrations/server/email.ts): SMTP_URL + SMTP_FROM. It is a
 * separate function because an invite is workspace-shaped, not task-shaped —
 * no reply-to inbound address, no task headers — and the failure policy
 * differs: an invite email is best-effort, the invitation row is the truth.
 */

function safeMailbox(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) && !/[\r\n]/.test(value);
}

export function invitationEmailConfigured(): boolean {
  const from = process.env.SMTP_FROM;
  return Boolean(process.env.SMTP_URL && from && safeMailbox(from));
}

/**
 * Sends the invite when SMTP is configured; silently does nothing when it is
 * not (the pre-email behavior — invitees still join on their next sign-in via
 * redeemInvitations). Throws only on an actual send failure; the caller
 * decides whether that voids the invitation (it should not).
 */
export async function sendInvitationEmail(input: {
  to: string;
  workspaceName: string;
  role: string;
}): Promise<void> {
  if (!invitationEmailConfigured()) return;
  const signInUrl = new URL(
    "/sign-in",
    process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
  ).toString();
  const transporter = nodemailer.createTransport(process.env.SMTP_URL);
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: input.to,
    subject: `You've been invited to ${input.workspaceName}`,
    text:
      `You've been invited to join the workspace "${input.workspaceName}" as ${input.role}.\n\n` +
      `Sign in with this email address to accept:\n${signInUrl}\n\n` +
      `The invitation expires in 14 days.`,
  });
}
