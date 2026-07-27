/**
 * Extensions (8.1) — a workspace-installed manifest renders in a named slot
 * inside a sandboxed iframe, and reads workspace data only through the bridge.
 *
 * A capability is the whole security model, so the vocabulary is deliberately
 * small, closed, and **read-only**: nothing here lets third-party code in an
 * iframe write to the workspace. Each capability names one projection the
 * bridge is willing to build (`EXTENSION_SCOPES`), and an extension gets a
 * projection only if its manifest asked for it at install time — when an owner
 * could read the list and say no.
 */

export const EXTENSION_CAPABILITIES = [
  "task.read",
  "comments.read",
  "labels.read",
  "board.read",
] as const;
export type ExtensionCapability = (typeof EXTENSION_CAPABILITIES)[number];

/**
 * The bridge's `?scope=` vocabulary, and the capability each scope costs. Two
 * separate names for one thing would drift, so this map is the single crossing
 * point — and the client's postMessage `method` is the capability itself.
 */
export const EXTENSION_SCOPES = {
  task: "task.read",
  comments: "comments.read",
  labels: "labels.read",
  board: "board.read",
} as const satisfies Record<string, ExtensionCapability>;
export type ExtensionScope = keyof typeof EXTENSION_SCOPES;

export function isExtensionScope(v: unknown): v is ExtensionScope {
  return typeof v === "string" && Object.hasOwn(EXTENSION_SCOPES, v);
}

/** capability → scope, for the client, which speaks in capability names. */
export function scopeForCapability(capability: unknown): ExtensionScope | null {
  const entry = Object.entries(EXTENSION_SCOPES).find(([, c]) => c === capability);
  return entry ? (entry[0] as ExtensionScope) : null;
}

export const EXTENSION_SLOTS = ["task_panel", "board_action", "card_badge", "custom_field_renderer"] as const;
export type ExtensionSlot = (typeof EXTENSION_SLOTS)[number];
export interface ExtensionManifest { name: string; url: string; capabilities: ExtensionCapability[]; slots: ExtensionSlot[]; version?: string; }
export interface WorkspaceExtension extends ExtensionManifest { id: number; workspaceId: string; installedBy: string; createdAt: string; updatedAt: string; }

/**
 * The projections the bridge hands an iframe, one per scope. Each is a shape
 * built for this purpose, never a row: a comment carries its author's display
 * name and not the user id or email, and the board arm carries column counts
 * rather than the cards themselves.
 */
export interface ExtensionTaskView { task: { id: number; title: string; description: string | null; dueDate: string | null; startDate: string | null } }
export interface ExtensionCommentsView { comments: { id: number; body: string; createdAt: string; author: { type: "human" | "agent"; name: string } }[] }
export interface ExtensionLabelsView { labels: { id: number; name: string; color: string }[] }
export interface ExtensionBoardView { board: { id: number; name: string; columnId: number }; columns: { id: number; title: string; position: number; taskCount: number }[] }
export type ExtensionView =
  | ExtensionTaskView
  | ExtensionCommentsView
  | ExtensionLabelsView
  | ExtensionBoardView;

export function readManifest(value: unknown): ExtensionManifest | null { if (!value || typeof value !== "object") return null; const v = value as Record<string, unknown>; if (typeof v.name !== "string" || !/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(v.name) || typeof v.url !== "string") return null; try { const url = new URL(v.url); if (url.protocol !== "https:") return null; } catch { return null; } if (!Array.isArray(v.capabilities) || !v.capabilities.every((x) => typeof x === "string" && (EXTENSION_CAPABILITIES as readonly string[]).includes(x))) return null; if (!Array.isArray(v.slots) || !v.slots.length || !v.slots.every((x) => typeof x === "string" && (EXTENSION_SLOTS as readonly string[]).includes(x))) return null; if (v.version !== undefined && typeof v.version !== "string") return null; return { name: v.name, url: v.url, capabilities: [...new Set(v.capabilities)] as ExtensionCapability[], slots: [...new Set(v.slots)] as ExtensionSlot[], version: v.version }; }
