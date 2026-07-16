import type { LabelColor } from "../types";

/**
 * The palette, as Tailwind classes.
 *
 * Written out per colour rather than interpolated (`bg-${color}-100`), because
 * Tailwind scans source text for complete class names — an interpolated one is
 * never in the CSS, so every chip would render unstyled. The repetition is not
 * an accident and should not be tidied into a template string.
 *
 * Both themes are stated. A chip is a small block of colour behind small text,
 * which is exactly where a light-mode tint becomes unreadable on a dark card.
 */
const CHIP_STYLES: Record<LabelColor, string> = {
  slate:
    "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  red: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  green: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
  violet:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300",
};

/** A dot in the same palette, for the picker's rows and the colour menu. */
const DOT_STYLES: Record<LabelColor, string> = {
  slate: "bg-slate-400",
  red: "bg-red-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

export function labelDotClass(color: LabelColor): string {
  return DOT_STYLES[color] ?? DOT_STYLES.slate;
}

interface LabelChipProps {
  name: string;
  /**
   * Optional because a card resolves colour by id against the workspace
   * vocabulary, and that lookup can miss for the moment between someone deleting
   * a label and the board refetching. Falling back to slate renders the name,
   * which is the part that matters; the alternative is a crash or a gap.
   */
  color?: LabelColor;
}

export function LabelChip({ name, color = "slate" }: LabelChipProps) {
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-[10px] font-medium leading-4 ${
        CHIP_STYLES[color] ?? CHIP_STYLES.slate
      }`}
    >
      {name}
    </span>
  );
}
