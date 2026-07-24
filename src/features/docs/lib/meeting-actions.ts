export interface MeetingAction { title: string; ownerHint: string | null; dueDate: string | null; }
/** Extracts explicit Markdown checkbox actions only; it never invents work from prose. */
export function extractMeetingActions(body: string): MeetingAction[] {
  return body.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*-\s*\[\s*\]\s+(.+?)\s*$/); if (!match) return [];
    const raw = match[1]; const due = raw.match(/\bdue\s+(\d{4}-\d{2}-\d{2})\b/i)?.[1] ?? null;
    const owner = raw.match(/(?:@|owner:\s*)([\w .-]+)/i)?.[1]?.trim() ?? null;
    const title = raw.replace(/\s*\(?owner:\s*[\w .-]+\)?/i, "").replace(/\s*\(?due\s+\d{4}-\d{2}-\d{2}\)?/i, "").trim();
    return title ? [{ title, ownerHint: owner, dueDate: due }] : [];
  });
}
