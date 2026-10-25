/** A fully settled tab with no activity for this long moves to "Settled". */
export const SETTLED_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type SectionableTab = {
  isSettled?: boolean;
  expenseCount?: number;
  /** Latest expense or settlement, whichever is newer. */
  lastExpenseDate?: string | null;
};

/**
 * Settled = every balance is zero, the tab has had expenses (an empty tab
 * isn't "settled", it's new) and nothing has happened for SETTLED_AFTER_MS.
 * Input order is preserved in both lists.
 */
export function splitSettledTabs<T extends SectionableTab>(
  tabs: readonly T[],
  now: number = Date.now(),
): { active: T[]; settled: T[] } {
  const active: T[] = [];
  const settled: T[] = [];
  for (const t of tabs) {
    const last = t.lastExpenseDate
      ? new Date(t.lastExpenseDate).getTime()
      : NaN;
    const isLongSettled =
      t.isSettled === true &&
      (t.expenseCount ?? 0) > 0 &&
      Number.isFinite(last) &&
      now - last > SETTLED_AFTER_MS;
    (isLongSettled ? settled : active).push(t);
  }
  return { active, settled };
}
