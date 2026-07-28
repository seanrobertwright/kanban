/** What a public link can point at (061, 085). */
export type ShareSubject = "doc" | "board" | "form" | "view" | "feedback";

/**
 * What a *guest share* can point at — the object_share CHECK, which is narrower
 * than a public link's on purpose. A saved view is a lens over a board rather
 * than an object to hand someone, and a feedback link is an anonymous door with
 * nobody on the other side to grant anything to.
 */
export type ObjectShareSubject = "doc" | "board" | "form";

/**
 * The public page a minted token resolves to — the one place the plural-path
 * convention (`/public/boards/…`) is written down for the client. Feedback has
 * no plural: `/public/feedback/<token>` is the portal for one board.
 */
export function publicPathForToken(
  subject: Exclude<ShareSubject, "view">,
  token: string
): string {
  const plural =
    subject === "board"
      ? "boards"
      : subject === "doc"
        ? "docs"
        : subject === "form"
          ? "forms"
          : "feedback";
  return `/public/${plural}/${token}`;
}
