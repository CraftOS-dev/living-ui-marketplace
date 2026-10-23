/** A part as a compact tile: its thumbnail, name, status, size and mass. */
import { Box, Pin, Sparkles } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { fileUrl } from '../lib/api.ts';
import { ago, mass, size, volume } from '../lib/format.ts';
import type { Unit } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import type { Part } from '../lib/types.ts';
import { Badge } from './ui.tsx';
import type { Tone } from './ui.tsx';

export function partStatus(p: Part): { tone: Tone; label: string; pulse: boolean } {
  switch (p.status) {
    case 'queued':
    case 'building':
      return { tone: 'info', label: 'Building', pulse: true };
    case 'failed':
      return { tone: 'bad', label: 'Does not build', pulse: false };
    case 'warning':
      return { tone: 'warn', label: 'Warnings', pulse: false };
    case 'empty':
      return { tone: 'neutral', label: 'Empty', pulse: false };
    default:
      return { tone: 'good', label: 'Built', pulse: false };
  }
}

export function Thumb({ p, className }: { p: Part; className?: string }): React.JSX.Element {
  return (
    <div className={cn('flex items-center justify-center overflow-hidden rounded-[var(--cw-r)] bg-[var(--cw-stage)]', className)}>
      {p.thumbnail !== '' ? <img src={fileUrl(p.thumbnail)} alt="" className="h-full w-full object-contain p-1" loading="lazy" /> : <Box size={18} strokeWidth={1.5} aria-hidden className="text-[var(--cw-on-stage-muted)]" />}
    </div>
  );
}

/** One line of what a part is: its size, else its feature count. */
export function partSize(p: Part, unit: Unit): string {
  return p.size_mm !== null ? size(p.size_mm, unit) : p.features !== undefined && p.features > 0 ? p.features + ' features' : 'No features yet';
}

export function PartCard({ p, unit }: { p: Part; unit: Unit }): React.JSX.Element {
  const st = partStatus(p);
  return (
    <button
      type="button"
      onClick={() => navigate('part', { id: p.id })}
      className="cw-rise group flex flex-col gap-1.5 rounded-[var(--cw-r-md)] border border-[var(--cw-line)] bg-[var(--cw-card)] p-1.5 text-left transition-colors hover:border-[var(--cw-muted)]"
    >
      <Thumb p={p} className="aspect-[4/3] w-full" />
      <div className="flex flex-col gap-0.5 px-1 pb-0.5">
        <div className="flex items-center justify-between gap-1.5">
          <span className="truncate text-[13px] font-bold">{p.name}</span>
          <span className="flex shrink-0 items-center gap-1">
            {p.pinned && <Pin size={12} aria-label="Pinned" className="text-[var(--cw-muted)]" />}
            {p.origin === 'agent' && <Sparkles size={12} aria-label="Started by your AI agent" className="text-[var(--cw-accent-text)]" />}
          </span>
        </div>
        <p className="num truncate text-[12px] text-[var(--cw-muted)]">{partSize(p, unit)}</p>
        <div className="flex items-center justify-between gap-1.5 pt-0.5">
          <Badge tone={st.tone} pulse={st.pulse}>
            {st.label}
          </Badge>
          <span className="num truncate text-[12px] text-[var(--cw-muted)]">{p.mass_g !== null ? mass(p.mass_g) : p.volume_mm3 !== null ? volume(p.volume_mm3, unit) : ago(p.updated)}</span>
        </div>
      </div>
    </button>
  );
}
