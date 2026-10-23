/**
 * Chart colors: five segment colors and "everything else", each with the
 * label color that reads on it. lib/themeColors.ts derives them from the
 * theme so every one differs from the others and shows on the card under it.
 */
export const SEGMENT_COLORS: { fill: string; text: string }[] = [0, 1, 2, 3, 4].map((i) => ({
  fill: `var(--erp-seg-${i})`,
  text: `var(--erp-seg-${i}-text)`,
}));

export const OTHER_COLOR = { fill: 'var(--erp-seg-other)', text: 'var(--erp-seg-other-text)' };

/** The same five for charts drawn on the dark card. */
export const DARK_SEGMENT_COLORS: { fill: string; text: string }[] = [0, 1, 2, 3, 4].map((i) => ({
  fill: `var(--erp-seg-dark-${i})`,
  text: `var(--erp-seg-dark-${i}-text)`,
}));

export function segmentColor(i: number, isOther: boolean, onDark = false): { fill: string; text: string } {
  if (isOther) return onDark ? { fill: 'var(--erp-dark-2)', text: 'var(--erp-on-dark)' } : OTHER_COLOR;
  const set = onDark ? DARK_SEGMENT_COLORS : SEGMENT_COLORS;
  return set[i % set.length] ?? OTHER_COLOR;
}
