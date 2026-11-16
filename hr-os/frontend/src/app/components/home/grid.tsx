/**
 * The Home grid (home-reports): Home's own panels and the modules' widgets
 * in one list, laid out so the page reads in the order it is written.
 *
 *   - No dense packing: every place sits after the one before it. Each row
 *     of twelve columns (from lg up) is filled by stretching its last place,
 *     so there are no holes and the order on screen is the order in the page
 *     at every width (one column below lg).
 *   - A module widget that draws nothing for this viewer (not theirs, nothing
 *     to show) takes no place and no number. A widget whose panel header does
 *     not show the number it is given (it does not take `index` yet) keeps
 *     its place but no number, so the count has no gap.
 *   - Numbers ("01", "02") go to the places this viewer actually sees, in
 *     that order, once the page has settled: its own read is in, every widget
 *     has mounted, and nothing has appeared or gone for a moment. Until then
 *     the panels show without numbers (no "01 04 10 11" while loading).
 *   - Widgets mount once the page's own read is in, a little apart.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../../kit/index.ts';
import type { HomeWidget } from '../../lib/contract.ts';

/** A place of Home's own: `numbers` panels inside it (0, 1, or 2 for a stacked column). */
export interface OwnPlace {
  key: string;
  /** Columns of 12 from lg up (the row's last place grows to fill the row, unless it keeps its span). */
  span: number;
  numbers: number;
  /** Keep this span when it ends a row (equal panels: an odd last one stays its size). */
  keep?: boolean | undefined;
  render: (index: (string | undefined)[]) => ReactNode;
}

export type Place = OwnPlace | { key: string; widget: HomeWidget };

/** Tailwind needs whole class names: one per span. */
const SPAN = ['', 'lg:col-span-1', 'lg:col-span-2', 'lg:col-span-3', 'lg:col-span-4', 'lg:col-span-5', 'lg:col-span-6', 'lg:col-span-7', 'lg:col-span-8', 'lg:col-span-9', 'lg:col-span-10', 'lg:col-span-11', 'lg:col-span-12'];

const WIDGET_GAP_MS = 120;
const SETTLE_MS = 300;

function isWidget(p: Place): p is { key: string; widget: HomeWidget } {
  return 'widget' in p;
}

function spanOf(p: Place): number {
  return isWidget(p) ? (p.widget.size === 'wide' ? 8 : 4) : p.span;
}

/**
 * Fill every row of twelve: a place that does not fit starts a new row, and
 * the row before grows its last place (unless that place keeps its span).
 */
export function packRows(spans: number[], keep?: boolean[]): number[] {
  const out = spans.map((s) => Math.max(1, Math.min(12, s)));
  let used = 0;
  let last = -1;
  for (let i = 0; i < out.length; i++) {
    const w = out[i] ?? 12;
    if (used + w > 12 && last >= 0) {
      if (keep?.[last] !== true) out[last] = (out[last] ?? 0) + 12 - used;
      used = 0;
    }
    used += w;
    last = i;
    if (used === 12) used = 0;
  }
  if (used > 0 && last >= 0 && keep?.[last] !== true) out[last] = (out[last] ?? 0) + 12 - used;
  return out;
}

/** Does this widget show the number it was given? Undecided (null) until its panel has a header label. */
function showsIndex(el: HTMLElement, index: string): boolean | null {
  const labels = [...el.querySelectorAll('.hr-label')];
  if (labels.length === 0) return null;
  return labels.some((x) => (x.textContent ?? '').trim() === index);
}

/** One module widget: mounts when its turn comes and tells the grid whether it draws anything, and whether it shows its number. */
function WidgetPlace({ place, widget, mountAt, span, visible, index, onSeen, onSilent }: { place: string; widget: HomeWidget; mountAt: number | null; span: number; visible: boolean; index: string | undefined; onSeen: (key: string, drawn: boolean) => void; onSilent: (key: string) => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (mounted || mountAt === null) return;
    const h = setTimeout(() => setMounted(true), mountAt);
    return () => clearTimeout(h);
  }, [mounted, mountAt]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || !mounted) return;
    const look = (): void => onSeen(place, el.childElementCount > 0);
    look();
    const mo = new MutationObserver(look);
    mo.observe(el, { childList: true });
    return () => mo.disconnect();
  }, [mounted, place, onSeen]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || !mounted || index === undefined) return;
    const check = (): void => {
      if (showsIndex(el, index) === false) onSilent(place);
    };
    check();
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [mounted, index, place, onSilent]);
  const C = widget.component;
  return (
    <div ref={ref} className={cn('min-w-0 [&>*]:h-full', visible ? SPAN[span] : 'hidden')}>
      {mounted ? <C index={index} /> : null}
    </div>
  );
}

/**
 * Home's grid. `ready`: the page's own read is in (widgets start then, and
 * numbers wait for it); `painted`: its panels have data to show (from
 * memory or the read). `className` adds to the grid (its gap and columns
 * are fixed here).
 */
export function HomeGrid({ places, ready, painted, className }: { places: Place[]; ready: boolean; painted?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  // What each widget draws (undefined: not mounted yet).
  const [drawn, setDrawn] = useState<Record<string, boolean>>({});
  const [settled, setSettled] = useState(false);
  // Widgets that do not show the number they are given: no number for them.
  const [silent, setSilent] = useState<Record<string, true>>({});
  const onSeen = useRef((key: string, d: boolean): void => {
    setDrawn((prev) => (prev[key] === d ? prev : { ...prev, [key]: d }));
  }).current;
  const onSilent = useRef((key: string): void => {
    setSilent((prev) => (prev[key] === true ? prev : { ...prev, [key]: true }));
  }).current;
  const widgetKeys = useMemo(() => places.filter(isWidget).map((p) => p.key), [places]);
  const allSeen = widgetKeys.every((k) => drawn[k] !== undefined);
  const sig = JSON.stringify(places.map((p) => p.key)) + JSON.stringify(drawn) + JSON.stringify(silent);
  // Settled: own read in, every widget mounted, and the set of places quiet for a moment.
  useEffect(() => {
    setSettled(false);
    if (!ready || !allSeen) return;
    const h = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(h);
  }, [ready, allSeen, sig]);

  const visible = places.filter((p) => !isWidget(p) || drawn[p.key] === true);
  const spans = packRows(
    visible.map(spanOf),
    visible.map((p) => !isWidget(p) && p.keep === true),
  );
  const spanByKey: Record<string, number> = {};
  visible.forEach((p, i) => (spanByKey[p.key] = spans[i] ?? 12));
  // Numbers in reading order, for the places on screen, once settled.
  const numbers: Record<string, (string | undefined)[]> = {};
  let n = 0;
  for (const p of visible) {
    const k = isWidget(p) ? (silent[p.key] === true ? 0 : 1) : p.numbers;
    const list: (string | undefined)[] = [];
    for (let i = 0; i < k; i++) list.push(settled ? String(++n).padStart(2, '0') : undefined);
    numbers[p.key] = list;
  }
  let w = 0;
  return (
    // data-ready: the page's own panels have data (first paint); data-settled: numbers are on.
    <div className={cn('grid grid-cols-1 gap-3 lg:grid-cols-12', className)} data-home-grid="" data-ready={painted === true ? '' : undefined} data-settled={settled ? '' : undefined}>
      {places.map((p) => {
        if (isWidget(p)) {
          const at = ready ? w++ * WIDGET_GAP_MS : null;
          return <WidgetPlace key={p.key} place={p.key} widget={p.widget} mountAt={at} span={spanByKey[p.key] ?? spanOf(p)} visible={drawn[p.key] === true} index={numbers[p.key]?.[0]} onSeen={onSeen} onSilent={onSilent} />;
        }
        return (
          <div key={p.key} className={cn('flex min-w-0 flex-col gap-3 [&>*:last-child]:flex-1', SPAN[spanByKey[p.key] ?? p.span])}>
            {p.render(numbers[p.key] ?? [])}
          </div>
        );
      })}
    </div>
  );
}
