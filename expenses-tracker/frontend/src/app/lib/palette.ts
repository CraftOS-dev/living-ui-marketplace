/**
 * Chart colors: five segment colors and "everything else", each with the
 * label color that reads on it. lib/themeColors.ts derives them from the
 * theme so every one differs from the others and shows on the sand card.
 */
export const SEGMENT_COLORS: { fill: string; text: string }[] = [0, 1, 2, 3, 4].map((i) => ({
  fill: `var(--et-seg-${i})`,
  text: `var(--et-seg-${i}-text)`,
}));

export const OTHER_COLOR = { fill: 'var(--et-seg-other)', text: 'var(--et-seg-other-text)' };

export function segmentColor(i: number, isOther: boolean): { fill: string; text: string } {
  if (isOther) return OTHER_COLOR;
  return SEGMENT_COLORS[i % SEGMENT_COLORS.length] ?? OTHER_COLOR;
}
