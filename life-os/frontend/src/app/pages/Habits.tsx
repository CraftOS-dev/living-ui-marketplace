/**
 * Habits: today's buttons to tap, grouped by the time of day, then the
 * tracker (the last two weeks, every square tappable), then new habits to
 * start with one tap or in your own words.
 */
import { useRef, useState } from 'react';
import { Flame } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useStatus } from '../lib/context.tsx';
import { plural } from '../lib/format.ts';
import { READS, useLive } from '../lib/live.ts';
import type { Habit } from '../lib/types.ts';
import { HABIT_ARTS, HabitArt } from '../components/art.tsx';
import { Panel, SubHead } from '../components/panel.tsx';
import { HabitGrid, HabitIdeas, HabitTile, habitsChanged, useHabitPanel } from '../components/habits.tsx';
import { PageBanner, PageBody } from '../components/page.tsx';
import { snack } from '../components/snack.tsx';
import { LoadError, Popover, Skeleton } from '../components/ui.tsx';

const PARTS: { key: Habit['time_of_day']; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
  { key: 'anytime', label: 'Any time' },
];

function OwnHabit(): React.JSX.Element {
  const [name, setName] = useState('');
  const [art, setArt] = useState('sprout');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const add = async (): Promise<void> => {
    if (name.trim() === '') return;
    await op('habits.create', { name: name.trim(), art, schedule: 'daily' });
    habitsChanged();
    snack(`Started "${name.trim()}"`);
    setName('');
    setArt('sprout');
  };
  return (
    <div className="flex items-center gap-2 rounded-[var(--lo-r)] border border-dashed border-[var(--lo-line)] bg-[var(--lo-card)] p-1.5 focus-within:border-solid focus-within:border-[var(--lo-accent)]">
      <button ref={ref} type="button" aria-label="Choose a drawing" title="Choose a drawing" onClick={() => setOpen(!open)} className="flex size-10 shrink-0 items-center justify-center rounded-[var(--lo-r-sm)] bg-[var(--lo-sunk)] hover:bg-[var(--lo-sunk-hover)]">
        <HabitArt art={art} size={30} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} className="w-[300px] p-2">
        <div className="grid grid-cols-6 gap-1">
          {HABIT_ARTS.map((a) => (
            <button
              key={a.key}
              type="button"
              title={a.label}
              aria-label={a.label}
              onClick={() => {
                setArt(a.key);
                setOpen(false);
              }}
              className={cn('flex size-11 items-center justify-center rounded-[var(--lo-r-sm)] border-2', art === a.key ? 'border-[var(--lo-moss)] bg-[var(--lo-moss-soft)]' : 'border-transparent hover:bg-[var(--lo-sunk)]')}
            >
              <HabitArt art={a.key} size={30} />
            </button>
          ))}
        </div>
      </Popover>
      <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="A habit in your own words" aria-label="New habit" maxLength={80} className="min-w-0 flex-1 bg-transparent px-1 text-[14px] font-semibold outline-none placeholder:text-[var(--lo-muted)]" />
      <button type="button" disabled={name.trim() === ''} onClick={() => void add()} className="h-9 shrink-0 rounded-[var(--lo-r-sm)] bg-[var(--lo-primary)] px-4 text-[13px] font-extrabold text-white hover:bg-[var(--lo-primary-hover)] disabled:opacity-40">
        Start
      </button>
    </div>
  );
}

export default function HabitsPage(): React.JSX.Element {
  const status = useStatus().data;
  const open = useHabitPanel();
  const live = useLive<{ habits: Habit[]; date: string; done: number; due: number }>((signal) => op('habits.list', {}, { quiet: true, signal }), READS.habits, []);
  const away = useLive<{ habits: Habit[] }>((signal) => op('habits.list', { archived: true }, { quiet: true, signal }), READS.habits, []);
  const d = live.data;
  const habits = d?.habits ?? [];
  const today = status?.today ?? d?.date ?? '';
  const best = habits.reduce<Habit | null>((b, h) => (b === null || h.streak > b.streak ? h : b), null);
  const archived = (away.data?.habits ?? []).filter((h) => h.archived);
  return (
    <div>
      <PageBanner
        seed="habits"
        title="Habits"
        subtitle={d === null ? undefined : habits.length === 0 ? 'Small things, done most days' : d.due === 0 ? 'Nothing due today' : d.done >= d.due ? `All ${d.due} done today` : `${d.done} of ${d.due} done today`}
        actions={
          best !== null && best.streak >= 2 ? (
            <span className="inline-flex items-center gap-1.5 rounded-[var(--lo-r)] bg-[var(--lo-card)] px-3 py-1.5 text-[13px] font-bold shadow-[var(--lo-shadow-sm)]">
              <Flame size={15} className="text-[var(--lo-art-clay)]" /> {best.name}: {plural(best.streak, 'day')} in a row
            </span>
          ) : undefined
        }
      />
      <PageBody className="flex flex-col gap-5">
        {d === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Skeleton className="h-40 w-full" />
          )
        ) : habits.length === 0 ? (
          <Panel title="Start with one" art={<HabitArt art="sprout" size={26} />}>
            <p className="mb-3 max-w-xl text-[14px] text-[var(--lo-ink-2)]">Tap a habit to start it. Each day you tap its button here or on Home, and the streak grows. Skipping a day on purpose never breaks it.</p>
            <HabitIdeas have={[]} />
            <div className="mt-4 max-w-xl">
              <OwnHabit />
            </div>
          </Panel>
        ) : (
          <>
            <Panel title="Today" art={<HabitArt art="outside" size={26} />} note={d.due === 0 ? 'Nothing due' : `${d.done} of ${d.due} done`}>
              <div className="grid grid-cols-1 gap-y-6 md:grid-flow-col md:auto-cols-fr md:gap-x-0">
                {PARTS.map((p) => {
                  const list = habits.filter((h) => h.time_of_day === p.key);
                  if (list.length === 0) return null;
                  return (
                    <div key={p.key} className="min-w-0 md:border-l md:border-[var(--lo-hair)] md:px-4 md:first:border-l-0 md:first:pl-0">
                      <SubHead>{p.label}</SubHead>
                      <div className="flex flex-wrap gap-x-2 gap-y-5">
                        {list.map((h) => (
                          <HabitTile key={h.id} habit={h} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title="The last two weeks" art={<HabitArt art="journal" size={24} />}>
              <HabitGrid habits={habits} today={today} />
            </Panel>

            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
              <Panel className={archived.length > 0 ? 'xl:col-span-8' : 'xl:col-span-12'} title="Start another" art={<HabitArt art="sprout" size={24} />}>
                <HabitIdeas have={habits} limit={10} />
                <div className="mt-4 max-w-xl">
                  <OwnHabit />
                </div>
              </Panel>
              {archived.length > 0 && (
                <Panel className="xl:col-span-4" title="Put away" note={String(archived.length)}>
                  <div className="flex flex-wrap gap-2">
                    {archived.map((h) => (
                      <button key={h.id} type="button" onClick={() => open(h.id)} className="flex h-10 items-center gap-2 rounded-[var(--lo-r)] bg-[var(--lo-sunk)] pl-1.5 pr-3 text-[13px] font-bold text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk-hover)]">
                        <HabitArt art={h.art} size={28} className="opacity-70" />
                        {h.name}
                      </button>
                    ))}
                  </div>
                </Panel>
              )}
            </div>
          </>
        )}
      </PageBody>
    </div>
  );
}
