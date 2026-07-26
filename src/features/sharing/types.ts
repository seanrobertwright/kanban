/** What a public link or guest share can point at (061). */
export type ShareSubject = "doc" | "board" | "form" | "view";

/**
 * The public page a minted token resolves to — the one place the plural-path
 * convention (`/public/boards/…`) is written down for the client.
 */
export function publicPathForToken(
  subject: Exclude<ShareSubject, "view">,
  token: string
): string {
  const plural = subject === "board" ? "boards" : subject === "doc" ? "docs" : "forms";
  return `/public/${plural}/${token}`;
}
