/**
 * A project as a journey: stepping stones from the start to a flag, one
 * stone per step. Done stones are filled in the area's color, the next one
 * glows, the rest wait.
 */
import { kindColor } from './bits.tsx';
import { ThingArt } from './art2.tsx';

export function Stones({ steps, kind, size = 'md' }: { steps: { id: string; title: string; done: boolean; stage: string }[]; kind: string; size?: 'sm' | 'md' | 'lg' | undefined }): React.JSX.Element {
  const max = size === 'sm' ? 12 : size === 'lg' ? 40 : 18;
  const shown = steps.length > max ? [...steps.filter((s) => s.done).slice(-Math.floor(max / 2)), ...steps.filter((s) => !s.done).slice(0, Math.ceil(max / 2))] : steps;
  const next = shown.findIndex((s) => !s.done);
  const w = size === 'lg' ? 30 : size === 'sm' ? 16 : 22;
  const h = Math.round(w * 0.62);
  return (
    <div className="flex items-end gap-0">
      <span className="flex items-end" style={{ minHeight: w + 8 }}>
        {shown.length === 0 && <span className="text-[12px] font-semibold text-[var(--lo-muted)]">No steps yet</span>}
        {shown.map((s, i) => {
          const up = i % 2 === 0 ? 0 : Math.round(h * 0.6);
          const isNext = i === next;
          return (
            <span key={s.id} title={s.title + (s.done ? ' (done)' : isNext ? ' (next)' : '')} className="relative -mr-0.5" style={{ marginBottom: up }}>
              <svg width={w + 4} height={h + 4} viewBox={`0 0 ${w + 4} ${h + 4}`} aria-hidden>
                <ellipse cx={(w + 4) / 2} cy={h / 2 + 3} rx={w / 2} ry={h / 2} fill="var(--lo-art-shadow)" />
                <ellipse cx={(w + 4) / 2} cy={h / 2 + 1} rx={w / 2} ry={h / 2} fill={s.done ? kindColor(kind) : isNext ? 'var(--lo-art-honey)' : 'var(--lo-art-stone)'} stroke={isNext ? 'var(--lo-art-honey-d)' : 'none'} strokeWidth={isNext ? 2 : 0} />
                {s.done && <ellipse cx={(w + 4) / 2 - w * 0.14} cy={h / 2 - h * 0.08} rx={w * 0.16} ry={h * 0.16} fill="var(--lo-art-white)" opacity="0.5" />}
              </svg>
            </span>
          );
        })}
      </span>
      <ThingArt kind="flag" size={w + 10} className="ml-1 shrink-0" />
    </div>
  );
}
