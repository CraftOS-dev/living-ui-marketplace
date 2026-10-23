/**
 * New part: made at once as "Part N" and opened, as desktop CAD opens an
 * untitled design; it is renamed in place, and its material and color live
 * in the part panel. The starters (offered in an empty part) are real
 * parametric features (parameters plus a sketch and features), so
 * everything about them stays editable.
 */
import { createContext, useCallback, useContext, useRef } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Box, Circle, Container, Grid2x2, Square } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { navigate } from '../lib/router.ts';
import { rgbCss, useViewportPalette } from '../lib/themeColors.ts';
import type { BodySlot, Json } from '../lib/types.ts';
import { errMessage } from './ui.tsx';

interface Starter {
  id: string;
  label: string;
  text: string;
  icon: LucideIcon;
  steps: Record<string, Json>[];
}

const SKETCH_RECT = (w: string, d: string, r: string): Json => ({
  plane: 'XY',
  items: [{ type: 'rectangle', id: 'r1', width: { expr: w }, height: { expr: d }, corner_radius: { expr: r } }],
});

export const STARTERS: Starter[] = [
  { id: 'empty', label: 'Empty', text: 'Start from nothing.', icon: Square, steps: [] },
  {
    id: 'block',
    label: 'Block',
    text: 'A rounded block driven by width, depth and height.',
    icon: Box,
    steps: [
      { op: 'params.set', name: 'width', value: '60', comment: 'Size along X' },
      { op: 'params.set', name: 'depth', value: '40', comment: 'Size along Y' },
      { op: 'params.set', name: 'height', value: '20', comment: 'Size along Z' },
      { op: 'params.set', name: 'corner', value: '4', comment: 'Corner radius' },
      { op: 'features.add', kind: 'sketch', params: SKETCH_RECT('width', 'depth', 'corner') },
      { op: 'features.add', kind: 'extrude', params: { sketch: 's1', extent: { type: 'distance', distance: { expr: 'height' } } } },
    ],
  },
  {
    id: 'plate',
    label: 'Mounting plate',
    text: 'A plate with four clearance holes, inset from the corners.',
    icon: Grid2x2,
    steps: [
      { op: 'params.set', name: 'width', value: '80', comment: 'Size along X' },
      { op: 'params.set', name: 'depth', value: '60', comment: 'Size along Y' },
      { op: 'params.set', name: 'thickness', value: '4' },
      { op: 'params.set', name: 'inset', value: '8', comment: 'Hole center to the edge' },
      { op: 'features.add', kind: 'sketch', params: SKETCH_RECT('width', 'depth', '4') },
      { op: 'features.add', kind: 'extrude', params: { sketch: 's1', extent: { type: 'distance', distance: { expr: 'thickness' } } } },
      {
        op: 'features.add',
        kind: 'hole',
        params: {
          face: { faces: { keys: ['ext1.cap_end'] }, expect: 1 },
          positions: [
            [{ expr: 'width/2 - inset' }, { expr: 'depth/2 - inset' }],
            [{ expr: '-(width/2 - inset)' }, { expr: 'depth/2 - inset' }],
            [{ expr: 'width/2 - inset' }, { expr: '-(depth/2 - inset)' }],
            [{ expr: '-(width/2 - inset)' }, { expr: '-(depth/2 - inset)' }],
          ],
          size: 'M4',
          fit: 'clearance',
          through: true,
        },
      },
    ],
  },
  {
    id: 'box',
    label: 'Open box',
    text: 'An enclosure: a block hollowed to a wall thickness, open at the top.',
    icon: Container,
    steps: [
      { op: 'params.set', name: 'width', value: '80', comment: 'Outside size along X' },
      { op: 'params.set', name: 'depth', value: '60', comment: 'Outside size along Y' },
      { op: 'params.set', name: 'height', value: '35', comment: 'Outside height' },
      { op: 'params.set', name: 'wall', value: '2', comment: 'Wall thickness' },
      { op: 'features.add', kind: 'sketch', params: SKETCH_RECT('width', 'depth', '5') },
      { op: 'features.add', kind: 'extrude', params: { sketch: 's1', extent: { type: 'distance', distance: { expr: 'height' } } } },
      { op: 'features.add', kind: 'shell', params: { remove: { faces: { keys: ['ext1.cap_end'] }, expect: 1 }, thickness: { expr: 'wall' } } },
    ],
  },
  {
    id: 'boss',
    label: 'Round boss',
    text: 'A cylinder with a center bore.',
    icon: Circle,
    steps: [
      { op: 'params.set', name: 'diameter', value: '30' },
      { op: 'params.set', name: 'height', value: '15' },
      { op: 'params.set', name: 'bore', value: '8' },
      {
        op: 'features.add',
        kind: 'sketch',
        params: {
          plane: 'XY',
          items: [
            { type: 'circle', id: 'c1', diameter: { expr: 'diameter' } },
            { type: 'circle', id: 'c2', diameter: { expr: 'bore' } },
          ],
        },
      },
      { op: 'features.add', kind: 'extrude', params: { sketch: 's1', extent: { type: 'distance', distance: { expr: 'height' } } } },
    ],
  },
];

export const SLOTS: { value: BodySlot; label: string }[] = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'accent', label: 'Accent' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'amber', label: 'Amber' },
  { value: 'red', label: 'Red' },
  { value: 'violet', label: 'Violet' },
  { value: 'graphite', label: 'Graphite' },
];

/** The body colors, each shown as the 3D view draws it in the current theme. */
export function ColorSwatches({ value, onChange }: { value: BodySlot; onChange: (v: BodySlot) => void }): React.JSX.Element {
  const pal = useViewportPalette();
  return (
    <div role="radiogroup" aria-label="Body color" className="flex flex-wrap gap-1">
      {SLOTS.map((s) => (
        <button
          key={s.value}
          type="button"
          role="radio"
          aria-checked={value === s.value}
          aria-label={s.label}
          title={s.label}
          onClick={() => onChange(s.value)}
          className={cn('flex size-6 items-center justify-center rounded-full ring-offset-1 ring-offset-[var(--cw-card)] transition-shadow', value === s.value ? 'ring-2 ring-[var(--cw-ink)]' : 'hover:ring-2 hover:ring-[var(--cw-line)]')}
        >
          <span className="size-5 rounded-full" style={{ background: rgbCss(pal.body[s.value]) }} />
        </button>
      ))}
    </div>
  );
}

interface Ctx {
  open: (from?: HTMLElement) => void;
}

const NewPartCtx = createContext<Ctx | null>(null);

const AUTO_NAME = /^Part (\d+)$/i;

/** The next free "Part N" (our own name pattern), across current and archived parts. */
async function nextName(): Promise<string> {
  const [live, archived] = await Promise.all([api.parts({ q: 'Part', limit: 200 }), api.parts({ q: 'Part', limit: 200, archived: true })]);
  let n = 0;
  for (const p of [...live.parts, ...archived.parts]) {
    const m = AUTO_NAME.exec(p.name);
    if (m !== null) n = Math.max(n, Number(m[1]));
  }
  return 'Part ' + (n + 1);
}

export function NewPartProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { settings } = useApp();
  const busy = useRef(false);
  const open = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    nextName()
      .then((name) => api.createPart({ name, material: settings?.default_material ?? '', color: 'neutral' }))
      .then((r) => navigate('part', { id: r.part.id }))
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => {
        busy.current = false;
      });
  }, [settings]);
  return <NewPartCtx.Provider value={{ open }}>{children}</NewPartCtx.Provider>;
}

export function useNewPart(): Ctx {
  const v = useContext(NewPartCtx);
  if (v === null) throw new Error('useNewPart outside NewPartProvider');
  return v;
}
