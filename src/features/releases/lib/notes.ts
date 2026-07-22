/**
 * Auto-generated release notes (2.8) — the pure heart of "what shipped in this
 * version". Given the titles of the tasks a release carries, compile a Markdown
 * bullet list (rendered through 033's safe renderer wherever notes are shown). A
 * release with no tasks yields null, so the caller can fall back to the tag body.
 *
 * Derive-don't-store's exception: notes are frozen at release time (a release is a
 * historical fact), so this runs once when a release ships, not on every read.
 */
export function compileReleaseNotes(taskTitles: string[]): string | null {
  const lines = taskTitles
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => `- ${t}`);
  return lines.length > 0 ? lines.join("\n") : null;
}
