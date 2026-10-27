/**
 * The journal: a page of lined paper for today. Pick a mood sticker, write,
 * and it keeps itself (no save button); the day's weather is noted on the
 * page; a photo goes on as a polaroid; the parts of life it touched go on as
 * stickers. A lock says whether your AI agent may read it.
 *
 * The timeline shows every page by month with a year of days above it, and
 * the week's recap counts the week by itself.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus, Lock, Trash2, Unlock, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op, opForm, opUrl } from '../lib/api.ts';
import { useStatus } from '../lib/context.tsx';
import { addDays, longDay, minutes, MONTHS, parseDay, plural, rangeLabel, temp, WD } from '../lib/format.ts';
import { changed, useLive } from '../lib/live.ts';
import { replaceQuery } from '../lib/router.ts';
import type { JournalEntry, Recap } from '../lib/types.ts';
import { useWeather } from '../lib/world.ts';
import { AgentButton } from '../components/agent.tsx';
import { AREA_NAMES, AreaArt, Mascot, MOOD_WORDS, MoodArt, WeatherArt, weatherWord } from '../components/art.tsx';
import { ColumnArt, NavArt, ThingArt } from '../components/art2.tsx';
import { kindColor, useKinds } from '../components/bits.tsx';
import { Panel, SubHead } from '../components/panel.tsx';
import { Heatmap } from '../components/charts.tsx';
import { PageBanner, PageBody } from '../components/page.tsx';
import { snack } from '../components/snack.tsx';
import { Button, LoadError, Segmented, Skeleton, useConfirm } from '../components/ui.tsx';

function journalChanged(): void {
  changed('journal_entries', 'days');
}

function photoUrl(e: JournalEntry): string {
  return opUrl('journal.photo', { entry: e.id, v: e.photo_key });
}

/* -------------------------------------------------------------- the page */

function Page({ entry, date, onSaved }: { entry: JournalEntry | null; date: string; onSaved: (e: JournalEntry) => void }): React.JSX.Element {
  const status = useStatus().data;
  const kinds = useKinds();
  const { weather } = useWeather();
  const [body, setBody] = useState(entry?.body ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [confirmEl, confirm] = useConfirm();
  const current = useRef<JournalEntry | null>(entry);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const isToday = date === status?.today;
  useEffect(() => {
    current.current = entry;
  }, [entry]);
  const write = async (patch: Record<string, unknown>): Promise<JournalEntry | null> => {
    setState('saving');
    try {
      const e = current.current;
      const r = await op<{ entry: JournalEntry }>('journal.write', e !== null ? { entry: e.id, ...patch } : { date, ...patch }, { quiet: true });
      current.current = r.entry;
      onSaved(r.entry);
      journalChanged();
      setState('saved');
      return r.entry;
    } catch {
      setState('idle');
      return null;
    }
  };
  const onBody = (v: string): void => {
    setBody(v);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (current.current === null && v.trim() === '') return;
      void write({ body: v });
    }, 700);
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const e = current.current ?? entry;
  const mood = e?.mood ?? 0;
  const tags = e?.tags ?? [];
  const w = e?.weather ?? (isToday && weather !== null ? { code: weather.current.code, temp: weather.current.temp, max: weather.days[0]?.max ?? 0, min: weather.days[0]?.min ?? 0, city: weather.place.city, units: weather.units } : null);
  const addPhoto = async (f: File): Promise<void> => {
    setState('saving');
    try {
      const cur = current.current;
      const r = await opForm<{ entry: JournalEntry }>('journal.write', cur !== null ? { entry: cur.id } : { date, body }, { photo: f });
      current.current = r.entry;
      onSaved(r.entry);
      journalChanged();
      setState('saved');
    } catch {
      setState('idle');
    }
  };
  const remove = async (): Promise<void> => {
    if (e === null) return;
    if (!(await confirm('This page will be deleted for good.', 'Delete this page?'))) return;
    await op('journal.delete', { entry: e.id });
    journalChanged();
    snack('Page deleted', { undo: false });
    replaceQuery({ entry: undefined });
  };
  return (
    <div className="mx-auto max-w-[820px]" data-unsaved={state === 'saving' ? 'true' : undefined}>
      {confirmEl}
      <div className="relative rounded-[6px] border border-[var(--lo-hair)] bg-[var(--lo-card)] shadow-[var(--lo-shadow-lg)]">
        <span aria-hidden className="absolute bottom-0 left-12 top-0 w-px bg-[var(--lo-art-red-l)] opacity-60" />
        <div className="flex flex-wrap items-start gap-4 pb-3 pl-16 pr-6 pt-6">
          <div className="min-w-0 flex-1">
            <p className="serif text-[26px] font-semibold leading-9">{longDay(date)}</p>
            {w !== null && (
              <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-[var(--lo-ink-2)]">
                <WeatherArt code={w.code} size={24} />
                {weatherWord(w.code)}, {temp(w.temp)}
                {w.city !== '' ? ` in ${w.city}` : ''}
              </p>
            )}
          </div>
          <div role="radiogroup" aria-label="How the day felt" className="flex gap-1">
            {[1, 2, 3, 4, 5].map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mood === m} title={MOOD_WORDS[m - 1]} aria-label={MOOD_WORDS[m - 1]} onClick={() => void write({ mood: mood === m ? 0 : m })} className={cn('rounded-full transition-transform', mood === m ? 'scale-125' : mood !== 0 ? 'opacity-35 hover:opacity-100' : 'hover:-translate-y-0.5')}>
                <MoodArt mood={m} size={34} />
              </button>
            ))}
          </div>
        </div>
        <div className="relative pl-16 pr-6">
          <textarea
            value={body}
            onChange={(ev) => onBody(ev.target.value)}
            placeholder={isToday ? (status?.prompt ?? 'How was today?') : 'What happened?'}
            aria-label="Write"
            className="lo-lined lo-autosize min-h-[384px] w-full resize-none bg-transparent pb-8 text-[15px] leading-8 outline-none [background-position:0_-3px] placeholder:text-[var(--lo-muted)] [font-family:var(--lo-serif)]"
          />
          {e !== null && e.has_photo && (
            <div className="group absolute -right-4 top-2 hidden w-[180px] rotate-3 bg-[var(--lo-art-white)] p-2 pb-7 shadow-[var(--lo-shadow-lg)] md:block">
              <img src={photoUrl(e)} alt="The photo on this page" className="aspect-square w-full object-cover" />
              <button type="button" aria-label="Take the photo off" onClick={() => void write({ remove_photo: true })} className="hit absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-[var(--lo-card)] text-[var(--lo-ink-2)] opacity-0 shadow-[var(--lo-shadow-sm)] group-hover:opacity-100">
                <X size={13} />
              </button>
            </div>
          )}
        </div>
        {e !== null && e.has_photo && (
          <div className="px-6 pb-3 md:hidden">
            <img src={photoUrl(e)} alt="The photo on this page" className="max-h-64 rounded-[var(--lo-r)] object-cover" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--lo-hair)] px-6 py-3">
          <div className="flex flex-wrap gap-1">
            {kinds.map((k) => {
              const on = tags.includes(k);
              return (
                <button key={k} type="button" aria-pressed={on} title={on ? `About ${AREA_NAMES[k]}` : `Is this about ${AREA_NAMES[k].toLowerCase()}?`} onClick={() => void write({ tags: JSON.stringify(on ? tags.filter((t) => t !== k) : [...tags, k]) })} className={cn('rounded-full p-0.5 transition', on ? 'scale-110' : 'opacity-35 grayscale hover:opacity-100 hover:grayscale-0')} style={on ? { background: kindColor(k, 'soft') } : undefined}>
                  <AreaArt kind={k} size={26} />
                </button>
              );
            })}
          </div>
          <span className="flex-1" />
          <input
            ref={file}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              if (f !== undefined) void addPhoto(f);
              ev.target.value = '';
            }}
          />
          <Button size="sm" variant="ghost" icon={ImagePlus} onClick={() => file.current?.click()}>
            {e?.has_photo === true ? 'Change photo' : 'Add a photo'}
          </Button>
          <Button
            size="sm"
            variant={e?.privacy === 'shared_with_agent' ? 'moss' : 'ghost'}
            icon={e?.privacy === 'shared_with_agent' ? Unlock : Lock}
            title={e?.privacy === 'shared_with_agent' ? 'Your AI agent can read this page' : 'Only you can read this page'}
            onClick={() => void write({ privacy: e?.privacy === 'shared_with_agent' ? 'private' : 'shared_with_agent' })}
            disabled={e === null}
          >
            {e?.privacy === 'shared_with_agent' ? 'Shared with your AI agent' : 'Only you'}
          </Button>
          {e !== null && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete this page" title="Delete this page" onClick={() => void remove()} />}
          <span className="w-16 text-right text-[12px] font-bold text-[var(--lo-muted)]" aria-live="polite">
            {state === 'saving' ? 'Saving' : state === 'saved' ? 'Kept' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

function Writer({ entryId }: { entryId: string }): React.JSX.Element {
  const today = useStatus().data?.today ?? '';
  const [loaded, setLoaded] = useState<{ entry: JournalEntry | null; date: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const run = async (): Promise<void> => {
      if (entryId !== '') {
        const r = await op<{ entry: JournalEntry }>('journal.get', { entry: entryId }, { quiet: true });
        if (alive) setLoaded({ entry: r.entry, date: r.entry.date });
      } else if (today !== '') {
        const r = await op<{ entries: JournalEntry[] }>('journal.list', { from: today, to: today, limit: 1 }, { quiet: true });
        if (alive) setLoaded({ entry: r.entries[0] ?? null, date: today });
      }
    };
    void run().catch(() => alive && setLoaded({ entry: null, date: today }));
    return () => {
      alive = false;
    };
  }, [entryId, today]);
  if (loaded === null) return <Skeleton className="mx-auto h-[480px] w-full max-w-[820px]" />;
  return <Page key={(loaded.entry?.id ?? 'new') + loaded.date} entry={loaded.entry} date={loaded.date} onSaved={(e) => setLoaded((l) => (l === null ? l : { ...l, entry: e }))} />;
}

/* ---------------------------------------------------------- the timeline */

function Timeline(): React.JSX.Element {
  const status = useStatus().data;
  const heat = useLive<{ days: { date: string; mood: number; n: number }[]; from: string; streak: number; entries: number }>((signal) => op('journal.heat', {}, { quiet: true, signal }), ['journal_entries'], []);
  const list = useLive<{ entries: JournalEntry[]; more: boolean }>((signal) => op('journal.list', { limit: 60 }, { quiet: true, signal }), ['journal_entries'], []);
  const mem = useLive<{ entries: JournalEntry[] }>((signal) => op('journal.memories', {}, { quiet: true, signal }), ['journal_entries'], []);
  const entries = list.data?.entries ?? [];
  const months = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    const k = e.date.slice(0, 7);
    months.set(k, [...(months.get(k) ?? []), e]);
  }
  const memories = mem.data?.entries ?? [];
  return (
    <div className="flex flex-col gap-5">
      {heat.data !== null && (
        <Panel title={`${plural(heat.data.entries, 'page')} this year`} art={<NavArt kind="journal" size={24} />} note={heat.data.streak > 1 ? `${heat.data.streak} days in a row` : undefined}>
          <Heatmap from={heat.data.from} levels={heat.data.days.map((d) => (d.n === 0 ? 0 : d.mood >= 4 ? 4 : d.mood === 3 ? 3 : d.mood > 0 ? 2 : 3))} weekStartsOn={status?.week_starts_on ?? 1} label="Pages over the last year" />
        </Panel>
      )}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
        <Panel className={memories.length > 0 ? 'xl:col-span-8' : 'xl:col-span-12'} title="Every page" art={<ThingArt kind="envelope" size={24} />} note={entries.length > 0 ? String(entries.length) : undefined}>
          {list.data === null ? (
            <Skeleton className="h-40 w-full" />
          ) : entries.length === 0 ? (
            <p className="text-[14px] text-[var(--lo-muted)]">Your pages will collect here.</p>
          ) : (
            <div className="flex flex-col gap-6">
              {[...months.entries()].map(([m, es]) => (
                <section key={m}>
                  <SubHead>
                    {MONTHS[parseDay(m + '-01').getMonth()]} {m.slice(0, 4)}
                  </SubHead>
                  <ul className="relative ml-2 flex flex-col gap-1 border-l-2 border-[var(--lo-track)] pl-5">
                    {es.map((e) => (
                      <li key={e.id} className="relative">
                        <span className="absolute -left-[31px] top-2 rounded-full bg-[var(--lo-card)]">{e.mood > 0 ? <MoodArt mood={e.mood} size={20} /> : <span className="m-1.5 block size-2 rounded-full bg-[var(--lo-line)]" />}</span>
                        <button type="button" onClick={() => replaceQuery({ tab: undefined, entry: e.id })} className="flex w-full items-start gap-3 rounded-[var(--lo-r)] px-3 py-2 text-left hover:bg-[var(--lo-sunk)]">
                          <span className="w-12 shrink-0 text-center">
                            <span className="block text-[12px] font-bold text-[var(--lo-muted)]">{WD[parseDay(e.date).getDay()]}</span>
                            <span className="serif num block text-[26px] font-semibold leading-8">{parseDay(e.date).getDate()}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="serif line-clamp-2 text-[15px] leading-6">{e.body !== '' ? e.body : <span className="text-[var(--lo-muted)]">A mood, no words</span>}</span>
                            <span className="mt-1 flex items-center gap-1">
                              {e.weather !== null && <WeatherArt code={e.weather.code} size={18} />}
                              {e.tags.map((t) => (
                                <AreaArt key={t} kind={t as never} size={18} />
                              ))}
                              {e.privacy === 'shared_with_agent' && <Unlock size={12} className="ml-1 text-[var(--lo-muted)]" />}
                              <span className="ml-1 text-[12px] font-semibold text-[var(--lo-muted)]">{plural(e.words, 'word')}</span>
                            </span>
                          </span>
                          {e.has_photo && <img src={photoUrl(e)} alt="" className="size-16 shrink-0 rotate-2 rounded-[4px] border-4 border-[var(--lo-art-white)] object-cover shadow-[var(--lo-shadow-sm)]" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Panel>
        {memories.length > 0 && (
          <Panel className="xl:col-span-4" title="On this day" art={<ThingArt kind="star" size={24} />}>
            <div className="flex flex-col gap-3">
              {memories.map((e) => (
                <button key={e.id} type="button" onClick={() => replaceQuery({ tab: undefined, entry: e.id })} className="lo-lined rounded-[6px] border border-[var(--lo-hair)] bg-[var(--lo-card)] px-4 py-2 text-left hover:shadow-[var(--lo-shadow)]">
                  <p className="text-[12px] font-bold text-[var(--lo-muted)]">
                    {longDay(e.date)}, {e.date.slice(0, 4)}
                  </p>
                  <p className="serif line-clamp-3 text-[15px] leading-8">{e.body}</p>
                </button>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- the week recap */

function Stat({ art, value, label }: { art: React.ReactNode; value: React.ReactNode; label: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      {art}
      <div>
        <p className="num text-[26px] font-extrabold leading-8">{value}</p>
        <p className="text-[12px] font-bold text-[var(--lo-muted)]">{label}</p>
      </div>
    </div>
  );
}

function RecapView(): React.JSX.Element {
  const today = useStatus().data?.today ?? '';
  const [date, setDate] = useState(today);
  const live = useLive<Recap>((signal) => op('recap.week', { date }, { quiet: true, signal }), ['recaps', 'tasks', 'habit_logs', 'workouts', 'focus_sessions', 'books', 'interactions', 'money_entries', 'journal_entries', 'days', 'wins', 'goals'], [date]);
  const r = live.data;
  const s = useStatus().data;
  if (r === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-64 w-full" />;
  const days = Array.from({ length: 7 }, (_, i) => addDays(r.week_start, i));
  const moodOf = new Map(r.mood.map((m) => [m.date, m.mood]));
  return (
    <div className="mx-auto flex max-w-[920px] flex-col gap-6">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Last week" onClick={() => setDate(addDays(r.week_start, -7))} className="flex size-8 items-center justify-center rounded-[var(--lo-r-sm)] hover:bg-[var(--lo-sunk)]">
          <ChevronLeft size={16} />
        </button>
        <p className="serif text-[15px] font-semibold">{rangeLabel(r.week_start, r.week_end)}</p>
        <button type="button" aria-label="Next week" disabled={r.week_end >= today} onClick={() => setDate(addDays(r.week_start, 7))} className="flex size-8 items-center justify-center rounded-[var(--lo-r-sm)] hover:bg-[var(--lo-sunk)] disabled:opacity-30">
          <ChevronRight size={16} />
        </button>
      </div>
      <Panel title="The week in numbers" art={<ColumnArt kind="coming" size={24} />} note={r.best_day !== '' ? `Best day: ${WD[parseDay(r.best_day).getDay()]}` : undefined}>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => (
            <div key={d} className={cn('flex flex-col items-center gap-1 rounded-[var(--lo-r)] py-2', d === r.best_day && 'bg-[var(--lo-moss-soft)]')}>
              <span className={cn('text-[12px] font-bold', d === r.best_day ? 'text-[var(--lo-moss-text)]' : 'text-[var(--lo-muted)]')}>{WD[parseDay(d).getDay()]}</span>
              {moodOf.get(d) !== undefined && (moodOf.get(d) ?? 0) > 0 ? <MoodArt mood={moodOf.get(d) ?? 3} size={32} /> : <span className="size-8 rounded-full border-2 border-dashed border-[var(--lo-track)]" />}
            </div>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat art={<ColumnArt kind="done" size={36} />} value={r.numbers.tasks_done} label="cards done" />
          <Stat art={<AreaArt kind="growth" size={36} />} value={r.numbers.habit_days} label="habit ticks" />
          <Stat art={<AreaArt kind="health" size={36} />} value={minutes(r.numbers.workout_min) || '0'} label="moving" />
          <Stat art={<ThingArt kind="timer" size={36} />} value={minutes(r.numbers.focus_min) || '0'} label="focused" />
          <Stat art={<AreaArt kind="relationships" size={36} />} value={r.numbers.people} label="people in touch" />
          <Stat art={<ThingArt kind="star" size={36} />} value={r.numbers.books_finished} label="books finished" />
          <Stat art={<AreaArt kind="money" size={36} />} value={s !== null ? (r.numbers.spent / Math.pow(10, s.digits)).toLocaleString(undefined, { maximumFractionDigits: 0 }) : r.numbers.spent} label={`${s?.currency ?? ''} spent`} />
          <Stat art={<ThingArt kind="envelope" size={36} />} value={r.numbers.journal} label="pages written" />
        </div>
      </Panel>
      {(r.wins.length > 0 || r.goals_moved.length > 0) && (
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
          {r.wins.length > 0 && (
            <Panel title="Wins" art={<ThingArt kind="trophy" size={24} />}>
              <ul className="flex flex-col gap-1">
                {r.wins.map((w, i) => (
                  <li key={i} className="flex items-center gap-2 text-[14px] font-semibold">
                    <ThingArt kind="star" size={18} /> {w}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {r.goals_moved.length > 0 && (
            <Panel title="Goals that moved" art={<ThingArt kind="flag" size={24} />}>
              <ul className="flex flex-col gap-1">
                {r.goals_moved.map((g) => (
                  <li key={g.id} className="flex items-center gap-2 text-[14px] font-semibold">
                    <AreaArt kind={g.area} size={20} /> <span className="min-w-0 flex-1 truncate">{g.title}</span>
                    <span className="num text-[13px] font-extrabold">{Math.round(g.progress * 100)}%</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
      <Panel title="In a few words" art={<Mascot size={26} />}>
        {r.agent_text !== '' ? (
          <p className="serif rounded-[var(--lo-r-lg)] bg-[var(--lo-accent-soft)] px-5 py-4 text-[15px] leading-7">{r.agent_text}</p>
        ) : (
          <AgentButton kind="recap" params={{ date: r.week_start }} label="Ask your AI agent to sum it up" />
        )}
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export default function JournalPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const tab = query.get('tab') ?? 'write';
  const entry = query.get('entry') ?? '';
  return (
    <div>
      <PageBanner
        seed="journal"
        title="Journal"
        actions={
          <Segmented
            label="Journal"
            value={tab}
            onChange={(v) => replaceQuery({ tab: v === 'write' ? undefined : v, entry: undefined })}
            options={[
              { value: 'write', label: entry !== '' ? 'The page' : 'Today' },
              { value: 'timeline', label: 'Timeline' },
              { value: 'recap', label: 'The week' },
            ]}
          />
        }
      />
      <PageBody>{tab === 'timeline' ? <Timeline /> : tab === 'recap' ? <RecapView /> : <Writer entryId={entry} />}</PageBody>
    </div>
  );
}
