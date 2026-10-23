/**
 * A project on the Projects page, in the same form as the Home shelf's
 * cards (the reference's repository card): its number with the stage as a
 * quiet label, what waits for you or the private mark as a tag, the point
 * cloud in the project's color, the name and question, then its to-do as
 * labelled fields: open, late and done tasks, the next task and its due day.
 */
import { useState } from 'react';
import { Lock, Pin, Sparkles } from 'lucide-react';
import { num } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import type { Project } from '../../lib/types.ts';
import { ProjectVisual, STAGE, stageOf } from '../home/ProjectCarousel.tsx';
import { ProjectTodo } from '../tasks/bits.tsx';

export function ProjectTile({ p, n }: { p: Project; n: number }): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const s = p.stats;
  const st = stageOf(p);
  const papers = s?.papers ?? 0;
  const density = papers * 3 + (s?.claims ?? 0) * 2 + (s?.evidence ?? 0) + (s?.highlights ?? 0) * 0.5;
  const tag = 'inline-flex h-5 shrink-0 items-center gap-1 border px-1.5 text-[12px] font-bold uppercase tracking-[0.12em]';
  return (
    <button
      type="button"
      onClick={() => navigate('project', { id: p.id })}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      aria-label={'Open ' + p.name}
      className="relative flex h-[330px] w-full flex-col overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-4 pt-5 text-left shadow-[var(--ro-shadow-sm)] transition-[border-color,box-shadow] hover:border-[var(--ro-ink-2)] hover:shadow-[var(--ro-shadow)]"
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: `var(--ro-pc-${p.color})` }} />
      <span className="flex items-center gap-2 border-b border-[var(--ro-line)] pb-3">
        <span className="num text-[26px] font-light leading-none">{String(n).padStart(2, '0')}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold uppercase tracking-[0.2em] text-[var(--ro-muted)]">{STAGE[st].label}</span>
        {p.pinned && <Pin size={12} className="shrink-0 text-[var(--ro-muted)]" aria-label="Pinned" />}
        {p.confidentiality === 'confidential' && (
          <span className={tag + ' border-[var(--ro-line)] text-[var(--ro-ink-2)]'} title="Your AI agent is kept out of this project">
            <Lock size={10} /> Private
          </span>
        )}
        {(s?.proposed ?? 0) > 0 && (
          <span className={tag + ' border-[var(--ro-accent)] text-[var(--ro-accent-text)]'} title="Proposed by your AI agent, waiting for you">
            <Sparkles size={10} /> {num(s?.proposed ?? 0)} to review
          </span>
        )}
      </span>
      <span className="relative min-h-0 flex-1" style={{ color: `var(--ro-pc-${p.color})` }}>
        <ProjectVisual seed={p.id} stage={st} density={density} live={hover} />
      </span>
      <span className="border-t border-[var(--ro-line)] pt-3">
        <span className="line-clamp-1 text-[15px] font-bold">{p.name}</span>
        <span className="mt-0.5 line-clamp-1 text-[12px] text-[var(--ro-ink-2)]">{p.question !== '' ? p.question : 'No research question yet'}</span>
        <ProjectTodo p={p} />
      </span>
    </button>
  );
}
