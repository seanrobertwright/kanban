import type { WorkspaceExtension } from "../types";

/** A board-action iframe is presentational until a future capability is granted;
 * it has no access to the parent document, cookies, or workspace data.
 *
 * The installed list now arrives as a prop from the page's server-side load,
 * shared with every other slot on the page, so this renders on first paint
 * instead of popping in after a round trip — and stops being a client component
 * altogether. Filtering by slot stays on this side: one list serves all four
 * slots, and only this one wants `board_action`. */
export function BoardExtensionActions({
  extensions,
}: {
  extensions: WorkspaceExtension[];
}) {
  const actions = extensions.filter((extension) =>
    extension.slots.includes("board_action")
  );
  if (!actions.length) return null;
  return (
    <span className="flex items-center gap-1">
      {actions.map((extension) => (
        <iframe
          key={extension.id}
          title={extension.name}
          src={extension.url}
          sandbox="allow-scripts"
          className="h-8 max-w-36 rounded border"
        />
      ))}
    </span>
  );
}
