/**
 * Goals / OKRs (037). An Objective is a qualitative outcome a board aims at; its
 * Key Results are the measurable targets that say whether it was met. Tasks and
 * milestones link to an objective (objective_id), the epic pattern one concept
 * over — but where an epic is a bucket of work, an objective is an outcome the
 * work is meant to move, measured by its KRs.
 */

/** One measurable target under an objective. */
export interface KeyResult {
  id: number;
  objectiveId: number;
  title: string;
  /** Where the metric started — the baseline a decreasing goal counts down from. */
  startValue: number;
  /** Where it needs to reach. */
  targetValue: number;
  /** Where it is now. */
  currentValue: number;
  /** The unit the three numbers are in ("%", "NPS"), display-only; "" for none. */
  unit: string;
  position: number;
  createdAt: string;
  /**
   * Derived fraction done in [0, 1] — (current − start) / (target − start),
   * clamped. Computed in the repository from the three values (not stored), so
   * the formula can change without a migration. See keyResultProgress.
   */
  progress: number;
}

export interface Objective {
  id: number;
  boardId: number;
  name: string;
  description: string;
  dueDate: string | null;
  createdAt: string;
  /** Its measurable targets, in display order. */
  keyResults: KeyResult[];
  /**
   * The mean of the key results' progress in [0, 1], or null when the objective
   * has no key results yet — an objective with nothing to measure has no
   * measurable progress, which is a different state from 0%. Derived at read time.
   */
  progress: number | null;
  /**
   * Work rollup (epic's shape, 031): top-level tasks aiming at this objective —
   * directly or through a member milestone — and how many are in the done column.
   * The effort tracker beside the metric: KRs say whether the outcome moved, this
   * says how much of the linked work is finished. done ≤ total.
   */
  total: number;
  done: number;
}

export interface CreateObjectiveInput {
  name: string;
  description?: string;
  dueDate?: string | null;
}

export interface UpdateObjectiveInput {
  name?: string;
  description?: string;
  dueDate?: string | null;
}

export interface CreateKeyResultInput {
  title: string;
  /** Absent means 0 — the usual baseline. */
  startValue?: number;
  targetValue: number;
  /** Absent means "start where it starts": currentValue defaults to startValue. */
  currentValue?: number;
  unit?: string;
}

export interface UpdateKeyResultInput {
  title?: string;
  startValue?: number;
  targetValue?: number;
  currentValue?: number;
  unit?: string;
  position?: number;
}

/** Names and titles sit in dialog rows, so cap them there. */
export const OBJECTIVE_NAME_MAX = 80;
export const KEY_RESULT_TITLE_MAX = 80;

/**
 * A key result's fraction done, in [0, 1]. (current − start) / (target − start),
 * clamped — storing the start is what makes a *decreasing* target read right:
 * churn 9 → 4 with current 6 is (6−9)/(4−9) = 0.6, three-fifths of the way down.
 *
 * When target equals start there is no span to measure, so it reads as met (1)
 * once current reaches the target and 0 otherwise — never a divide-by-zero.
 */
export function keyResultProgress(kr: {
  startValue: number;
  targetValue: number;
  currentValue: number;
}): number {
  const span = kr.targetValue - kr.startValue;
  if (span === 0) {
    // No distance to cover: met iff we are at (or past) the target.
    const reached =
      kr.targetValue >= kr.startValue
        ? kr.currentValue >= kr.targetValue
        : kr.currentValue <= kr.targetValue;
    return reached ? 1 : 0;
  }
  const raw = (kr.currentValue - kr.startValue) / span;
  return Math.max(0, Math.min(1, raw));
}

/** An objective's progress: the mean of its key results' progress, or null when
 *  it has none — nothing to measure is not the same as 0% done. */
export function objectiveProgress(
  keyResults: { progress: number }[]
): number | null {
  if (keyResults.length === 0) return null;
  const sum = keyResults.reduce((acc, kr) => acc + kr.progress, 0);
  return sum / keyResults.length;
}
