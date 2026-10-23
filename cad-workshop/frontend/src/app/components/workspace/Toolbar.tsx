/**
 * The modelling toolbar: every tool one click away, grouped as in desktop
 * CAD (create, modify, pattern, bodies), with its shortcut in the tooltip.
 * A tool the current selection is ready for gets a dot: edges selected
 * light up Fillet and Chamfer, a flat face lights up Sketch, Push/pull and
 * Hole, a picked profile lights up Extrude and Revolve.
 */
import type { LucideIcon } from 'lucide-react';
import { Box, Cylinder, Globe } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { iconByName } from '../../lib/icons.ts';
import type { FeatureKind, Schema } from '../../lib/types.ts';
import { TOOLS } from './tools.ts';

export type ToolId = FeatureKind | 'box' | 'cylinder' | 'sphere';

const GROUPS: ToolId[][] = [
  ['sketch', 'extrude', 'revolve', 'box', 'cylinder', 'sphere'],
  ['push_pull', 'fillet', 'chamfer', 'shell', 'hole'],
  ['pattern_linear', 'pattern_circular', 'mirror'],
  ['boolean', 'transform', 'import_step'],
];

const SHORT: Partial<Record<ToolId, string>> = {
  pattern_linear: 'Pattern',
  pattern_circular: 'Circular',
  import_step: 'Import',
  boolean: 'Combine',
  transform: 'Move',
  push_pull: 'Push/pull',
};

const PRIMS: Record<'box' | 'cylinder' | 'sphere', { label: string; icon: LucideIcon }> = {
  box: { label: 'Box', icon: Box },
  cylinder: { label: 'Cylinder', icon: Cylinder },
  sphere: { label: 'Sphere', icon: Globe },
};

export function Toolbar({ schema, ready, disabled, onTool }: { schema: Schema; ready: ToolId[]; disabled: boolean; onTool: (t: ToolId) => void }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {GROUPS.map((g, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <span className="mx-1 h-7 w-px bg-[var(--cw-line)]" />}
          {g.map((t) => {
            const prim = t === 'box' || t === 'cylinder' || t === 'sphere' ? PRIMS[t] : null;
            const def = prim === null ? schema.kinds[t as FeatureKind] : null;
            const Icon = prim?.icon ?? iconByName(def?.icon ?? 'Box');
            const label = prim?.label ?? SHORT[t] ?? def?.label ?? t;
            const key = prim === null ? TOOLS[t as FeatureKind].key : null;
            const on = ready.includes(t);
            return (
              <button
                key={t}
                type="button"
                disabled={disabled}
                title={(def?.label ?? label) + (key !== null ? ' (' + key + ')' : '') + (def?.summary !== undefined ? '\n' + def.summary : '')}
                aria-label={label}
                onClick={() => onTool(t)}
                className={cn(
                  'relative flex h-11 min-w-[50px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[var(--cw-r-sm)] px-1 text-[12px] leading-none transition-colors disabled:cursor-default disabled:opacity-40',
                  'text-[var(--cw-ink-2)] hover:bg-[var(--cw-row)] hover:text-[var(--cw-ink)]',
                )}
              >
                <Icon size={17} strokeWidth={1.75} aria-hidden className={on ? 'text-[var(--cw-accent-text)]' : undefined} />
                <span className={cn('whitespace-nowrap', on && 'font-semibold text-[var(--cw-ink)]')}>{label}</span>
                {on && <span aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-[var(--cw-accent)]" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
