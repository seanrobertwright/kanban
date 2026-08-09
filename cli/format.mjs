// TTY rendering for the kanban CLI — phase 3.
//
// Only the interactive case lands here: piped output and --json stay exactly
// the JSON they were, so scripts written against phases 1-2 see no change.
// The renderer is deliberately generic — a table for any array of flat
// objects — with one special case for the shapes that carry their list in a
// property (search results, notifications). Anything that does not fit stays
// pretty-printed JSON, which is always correct, just less scannable.

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const bold = (s) => (COLOR ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s) => (COLOR ? `\x1b[2m${s}\x1b[0m` : s);

// Columns worth leading with, when present. Everything else follows in the
// object's own key order.
const PREFERRED = [
  "id", "title", "name", "kind", "type", "status", "role", "priority",
  "columnId", "position", "assignee", "dueDate", "done", "content",
];

const MAX_COLUMNS = 8;
const MAX_CELL = 40;

function cell(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    // {type,id} assignees and similar tiny shapes read fine compacted; bigger
    // structures get elided rather than wrapping the row.
    const s = JSON.stringify(value);
    return s.length <= MAX_CELL ? s : s.slice(0, MAX_CELL - 1) + "…";
  }
  const s = String(value);
  return s.length <= MAX_CELL ? s : s.slice(0, MAX_CELL - 1) + "…";
}

/** A table for an array of objects, or null when the shape does not fit. */
function table(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) return null;

  const seen = new Set();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  const columns = [
    ...PREFERRED.filter((k) => seen.has(k)),
    ...[...seen].filter((k) => !PREFERRED.includes(k)),
  ].slice(0, MAX_COLUMNS);
  if (columns.length === 0) return null;

  const grid = [columns, ...rows.map((r) => columns.map((c) => cell(r[c])))];
  const widths = columns.map((_, i) => Math.max(...grid.map((row) => row[i].length)));
  const line = (row, style = (s) => s) =>
    row.map((v, i) => style(v.padEnd(widths[i]))).join("  ").trimEnd();

  return [
    line(grid[0], bold),
    line(widths.map((w) => "─".repeat(w)), dim),
    ...grid.slice(1).map((row) => line(row)),
  ].join("\n");
}

/**
 * Render for a human at a TTY. Arrays become tables; an object whose payload
 * is a single array property (tasks, items, columns…) becomes that table with
 * its leftover scalars as a footer line. Everything else: pretty JSON.
 */
export function renderForTTY(data) {
  const direct = table(data);
  if (direct !== null) return direct;

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const arrayProps = Object.entries(data).filter(
      ([, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === "object"
    );
    if (arrayProps.length === 1) {
      const [listName, list] = arrayProps[0];
      const t = table(list);
      if (t !== null) {
        const rest = Object.entries(data)
          .filter(([k, v]) => k !== listName && (v === null || typeof v !== "object"))
          .map(([k, v]) => `${k}: ${cell(v)}`);
        const footer = rest.length ? `\n\n${dim(rest.join("  ·  "))}` : "";
        return `${dim(listName)}\n${t}${footer}`;
      }
    }
  }

  return JSON.stringify(data, null, 2);
}
