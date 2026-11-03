/**
 * Learn: every lesson from the first keys to chromatic harmony, in twelve
 * units, and the path: ten levels, each asking for lessons, skills,
 * technique, sight-reading and pieces. A lesson opens full page.
 */
import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, BookOpen, Check, Dumbbell, Ear, Eye, Hand, Library, Music2, Piano, Route } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { Ring } from '../components/charts.tsx';
import { PageHeader, Panel, Segmented, Spinner } from '../components/ui.tsx';
import { useLive } from '../lib/live.ts';
import { api } from '../lib/api.ts';
import { navigate, useRoute } from '../lib/router.ts';
import type { LearnState, LessonInfo, PathItem, PathLevel } from '../lib/types.ts';
import { LessonPlayer } from '../learn/LessonPlayer.tsx';
import { openSkill } from './Train.tsx';

export function useLearn(): { data: LearnState | null; reload: () => void } {
  const live = useLive(() => api.learn(), ['lessons', 'skills', 'drills', 'settings', 'progress', 'songs'], [], 200, 1200);
  return { data: live.data, reload: live.reload };
}

const TRACK_ICON: Record<string, LucideIcon> = { lessons: BookOpen, reading: Eye, rhythm: Music2, ear: Ear, theory: Piano, technique: Hand, sight: Eye, repertoire: Library };

export function LearnPage(): React.JSX.Element {
  const { query } = useRoute();
  const learn = useLearn();
  const lessonKey = query.get('lesson');
  const view = query.get('view') === 'path' ? 'path' : 'lessons';
  const s = learn.data;

  if (lessonKey !== null && s !== null) {
    const info = s.lessons.find((l) => l.key === lessonKey);
    if (info !== undefined) {
      const order = s.lessons.slice().sort((a, b) => a.level - b.level || s.units.findIndex((u) => u.key === a.unit) - s.units.findIndex((u) => u.key === b.unit));
      const at = order.findIndex((l) => l.key === info.key);
      const next = order.slice(at + 1).find((l) => !l.done) ?? order[at + 1] ?? null;
      const page = query.get('page');
      return (
        <LessonPlayer
          info={info}
          unitTitle={s.units.find((u) => u.key === info.unit)?.title ?? ''}
          skills={s.skills}
          next={next}
          startPage={page !== null && page !== '' ? Number(page) : null}
          doneStep={query.get('done') === '1' && query.get('step') !== null ? Number(query.get('step')) : null}
          block={query.get('block') !== null && query.get('block') !== '' ? Number(query.get('block')) : null}
          onExit={() => navigate('learn')}
          onOpen={(k) => navigate('learn', { lesson: k })}
        />
      );
    }
  }

  return (
    <div className="pc-scroll h-full overflow-y-auto">
      <PageHeader title="Learn" meta={s !== null ? `Level ${s.level} · ${s.path[s.level - 1]?.name ?? ''}` : undefined}>
        <Segmented
          value={view}
          onChange={(v) => navigate('learn', { view: v === 'path' ? 'path' : undefined })}
          options={[
            { value: 'lessons', label: 'Lessons', icon: BookOpen },
            { value: 'path', label: 'Path', icon: Route },
          ]}
          label="View"
        />
      </PageHeader>
      {s === null ? (
        <div className="flex h-[60vh] items-center justify-center text-[var(--pc-muted)]">
          <Spinner size={18} />
        </div>
      ) : view === 'path' ? (
        <PathView s={s} />
      ) : (
        <LessonsView s={s} />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- lessons */

function LessonsView({ s }: { s: LearnState }): React.JSX.Element {
  const nx = s.next.lesson;
  const done = s.lessons.filter((l) => l.done).length;
  const nextInfo = nx !== null ? s.lessons.find((l) => l.key === nx.key) ?? null : null;
  return (
    <div className="flex flex-col gap-3 px-5 pb-10 pt-3 md:px-7">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {nextInfo !== null ? (
          <button type="button" onClick={() => navigate('learn', { lesson: nextInfo.key })} className="pc-panel pc-focus group relative flex items-center gap-5 overflow-hidden px-5 py-5 text-left transition-colors hover:bg-[var(--pc-hover)] lg:col-span-8">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--pc-ink)] text-[var(--pc-page)] transition-transform duration-200 group-hover:scale-105">
              <ArrowRight size={20} strokeWidth={2.2} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="pc-label block">{s.units.find((u) => u.key === nextInfo.unit)?.title}</span>
              <span className="mt-0.5 block truncate text-[19px] font-semibold tracking-[-0.01em]">{nextInfo.title}</span>
            </span>
            <span className="pc-mono pc-num hidden shrink-0 text-[12px] text-[var(--pc-muted)] sm:block">{nextInfo.minutes} min</span>
          </button>
        ) : (
          <div className="pc-panel flex items-center gap-4 px-5 py-5 lg:col-span-8">
            <span className="flex size-12 items-center justify-center rounded-full bg-[var(--pc-good)] text-white">
              <Check size={22} strokeWidth={2.4} aria-hidden />
            </span>
            <span className="text-[16px] font-semibold">Every lesson up to your level is done</span>
          </div>
        )}
        <div className="pc-panel flex items-center gap-4 px-5 py-4 lg:col-span-4">
          <Ring value={done / Math.max(1, s.lessons.length)} size={52} stroke={4}>
            <span className="pc-mono pc-num text-[12px] font-semibold">{Math.round((done / Math.max(1, s.lessons.length)) * 100)}%</span>
          </Ring>
          <div className="leading-tight">
            <div className="pc-mono pc-num text-[22px] font-medium">
              {done}
              <span className="text-[14px] text-[var(--pc-muted)]">/{s.lessons.length}</span>
            </div>
            <div className="pc-label">Lessons</div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {s.units.map((u, ui) => {
          const list = s.lessons.filter((l) => l.unit === u.key).sort((a, b) => a.level - b.level);
          const d = list.filter((l) => l.done).length;
          return (
            <Panel key={u.key} index={String(ui + 1).padStart(2, '0')} label={u.title} aside={<span className="pc-mono pc-num text-[11px] text-[var(--pc-muted)]">{d}/{list.length}</span>} bodyClass="px-1.5 pb-1.5">
              <div className="flex flex-col">
                {list.map((l) => (
                  <LessonRow key={l.key} l={l} above={l.level > s.level} next={l.key === nx?.key} />
                ))}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

function LessonRow({ l, above, next }: { l: LessonInfo; above: boolean; next: boolean }): React.JSX.Element {
  return (
    <button type="button" onClick={() => navigate('learn', { lesson: l.key })} className={cn('pc-focus group flex h-10 items-center gap-3 rounded-[var(--pc-radius-sm)] px-2 text-left transition-colors hover:bg-[var(--pc-hover)]', next && 'bg-[var(--pc-active)]')}>
      <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full transition-colors', l.done ? 'bg-[var(--pc-ink)] text-[var(--pc-page)]' : next ? 'border-[1.5px] border-[var(--pc-ink)]' : 'border border-[var(--pc-line-2)]')}>
        {l.done && <Check size={11} strokeWidth={3} aria-hidden />}
      </span>
      <span className={cn('min-w-0 flex-1 truncate text-[13px]', above && !l.done ? 'text-[var(--pc-muted)]' : 'text-[var(--pc-ink)]', next && 'font-semibold')}>{l.title}</span>
      {l.done && l.score < 0.999 && <span className="pc-mono pc-num text-[10.5px] text-[var(--pc-faint)]">{Math.round(l.score * 100)}%</span>}
      <span className="pc-mono shrink-0 rounded-[4px] bg-[var(--pc-sunk)] px-1.5 py-0.5 text-[10px] text-[var(--pc-muted)]">L{l.level}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ path */

function PathView({ s }: { s: LearnState }): React.JSX.Element {
  const [open, setOpen] = useState<number>(s.level);
  const tracks = s.tracks;
  return (
    <div className="flex flex-col gap-3 px-5 pb-10 pt-3 md:px-7">
      <Panel label="Levels" aside={<span className="pc-label">{s.path.filter((l) => l.done).length}/10</span>} bodyClass="px-0 pb-0">
        <div className="pc-scroll overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left">
                <th className="pc-label w-[220px] px-3.5 pb-2 font-medium">Level</th>
                {tracks.map((t) => {
                  const Icon = TRACK_ICON[t.key] ?? BookOpen;
                  return (
                    <th key={t.key} className="pc-label px-1 pb-2 text-center font-medium" title={t.title}>
                      <span className="inline-flex flex-col items-center gap-1">
                        <Icon size={13} strokeWidth={1.8} aria-hidden />
                        <span className="hidden xl:inline">{t.title.split(' ')[0]}</span>
                      </span>
                    </th>
                  );
                })}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {s.path.map((lv) => (
                <LevelRow key={lv.level} lv={lv} current={lv.level === s.level} tracks={tracks.map((t) => t.key)} open={open === lv.level} onToggle={() => setOpen(open === lv.level ? 0 : lv.level)} />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {open > 0 && s.path[open - 1] !== undefined && <LevelDetail lv={s.path[open - 1]!} s={s} />}
    </div>
  );
}

function LevelRow({ lv, current, tracks, open, onToggle }: { lv: PathLevel; current: boolean; tracks: string[]; open: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <tr onClick={onToggle} className={cn('cursor-pointer border-t border-[var(--pc-hair)] transition-colors hover:bg-[var(--pc-hover)]', open && 'bg-[var(--pc-active)]')}>
      <td className="px-3.5 py-2">
        <span className="flex items-center gap-2.5">
          <span className={cn('pc-mono flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', lv.done ? 'bg-[var(--pc-ink)] text-[var(--pc-page)]' : current ? 'border-[1.5px] border-[var(--pc-ink)] text-[var(--pc-ink)]' : 'border border-[var(--pc-line-2)] text-[var(--pc-muted)]')}>{lv.done ? <Check size={12} strokeWidth={3} aria-hidden /> : lv.level}</span>
          <span className={cn('truncate', current ? 'font-semibold' : lv.done ? '' : 'text-[var(--pc-ink-2)]')}>{lv.name}</span>
        </span>
      </td>
      {tracks.map((t) => {
        const c = lv.tracks[t] ?? { done: 0, total: 0 };
        return (
          <td key={t} className="px-1 py-2 text-center">
            {c.total === 0 ? (
              <span className="text-[var(--pc-faint)]">·</span>
            ) : (
              <span className="inline-flex" title={`${c.done}/${c.total}`}>
                <Ring value={c.done / c.total} size={20} stroke={2.5} color={c.done === c.total ? 'var(--pc-good)' : 'var(--pc-ink)'} />
              </span>
            )}
          </td>
        );
      })}
      <td className="pc-mono pc-num pr-3.5 text-right text-[11px] text-[var(--pc-muted)]">
        {lv.met}/{lv.total}
      </td>
    </tr>
  );
}

function LevelDetail({ lv, s }: { lv: PathLevel; s: LearnState }): React.JSX.Element {
  const groups = useMemo(() => {
    const out = new Map<string, PathItem[]>();
    for (const it of lv.items) {
      const list = out.get(it.track) ?? [];
      list.push(it);
      out.set(it.track, list);
    }
    return [...out.entries()];
  }, [lv]);
  return (
    <Panel index={String(lv.level).padStart(2, '0')} label={lv.name} aside={<span className="pc-mono pc-num text-[11px] text-[var(--pc-muted)]">{lv.met}/{lv.total}</span>} className="pc-rise">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map(([track, items]) => {
          const t = s.tracks.find((x) => x.key === track);
          const Icon = TRACK_ICON[track] ?? BookOpen;
          return (
            <div key={track} className="flex flex-col gap-1">
              <div className="pc-label mb-1 flex items-center gap-1.5">
                <Icon size={12} aria-hidden /> {t?.title ?? track}
              </div>
              {items.map((it) => (
                <Requirement key={it.kind + it.key} it={it} s={s} />
              ))}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Requirement({ it, s }: { it: PathItem; s: LearnState }): React.JSX.Element {
  const go = (): void => {
    if (it.kind === 'lesson') navigate('learn', { lesson: it.key });
    else if (it.kind === 'skill' || it.kind === 'sight') {
      const sk = s.skills.find((x) => x.key === it.key);
      if (sk !== undefined) openSkill(sk);
    } else if (it.kind === 'scales') navigate('train', { tech: 'scales' });
    else navigate('library');
  };
  const frac = it.need !== undefined && it.have !== undefined ? Math.min(1, it.have / Math.max(1e-9, it.need)) : it.ok ? 1 : 0;
  const Icon = it.kind === 'lesson' ? BookOpen : it.kind === 'songs' || it.kind === 'program' ? Library : Dumbbell;
  return (
    <button type="button" onClick={go} className="pc-focus group flex min-h-9 items-center gap-2.5 rounded-[var(--pc-radius-sm)] px-1.5 py-1 text-left transition-colors hover:bg-[var(--pc-hover)]">
      <span className={cn('flex size-[18px] shrink-0 items-center justify-center rounded-full', it.ok ? 'bg-[var(--pc-good)] text-white' : 'border border-[var(--pc-line-2)] text-[var(--pc-muted)]')}>{it.ok ? <Check size={10} strokeWidth={3} aria-hidden /> : <Icon size={9} aria-hidden />}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[12.5px]', it.ok ? 'text-[var(--pc-muted)]' : 'text-[var(--pc-ink)]')}>{it.title}</span>
        {!it.ok && it.kind !== 'lesson' && (
          <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-[var(--pc-line)]">
            <span className="block h-full rounded-full bg-[var(--pc-ink)] transition-[width] duration-700" style={{ width: `${frac * 100}%` }} />
          </span>
        )}
      </span>
      {!it.ok && <ArrowRight size={13} aria-hidden className="shrink-0 text-[var(--pc-faint)] opacity-0 transition-opacity group-hover:opacity-100" />}
    </button>
  );
}

