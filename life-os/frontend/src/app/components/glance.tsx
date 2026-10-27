/**
 * Small live tools shared by Home and the area pages: the weather (now, by
 * the hour, the week), the news, water glasses to tap, a quick spend, mood
 * stickers, the people to reach and what is coming up.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ExternalLink, MapPin } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { bounce } from '../lib/motion.ts';
import { useStatus } from '../lib/context.tsx';
import { ago, parseDay, relDay, temp, WD } from '../lib/format.ts';
import { act, changed, localDay, patchWhere } from '../lib/live.ts';
import type { ComingItem, Habit, HealthLog, Person, Place, Weather } from '../lib/types.ts';
import { TOPIC_NAMES, useNews } from '../lib/world.ts';
import { Avatar, CategoryArt, HabitArt, MOOD_WORDS, MoodArt, SPEND_CATEGORIES, WeatherArt, weatherWord } from './art.tsx';
import { ColumnArt, ThingArt } from './art2.tsx';
import { Chip } from './bits.tsx';
import { Face, touch, usePersonPanel } from './people.tsx';
import { snack } from './snack.tsx';
import { Skeleton } from './ui.tsx';

/* --------------------------------------------------------------- weather */

/** Now: the drawing, the temperature, the words; on a card that sits on the sky. */
export function WeatherNow({ weather, className }: { weather: Weather; className?: string | undefined }): React.JSX.Element {
  const d0 = weather.days[0];
  const wet = weather.hours.slice(0, 12).find((h) => h.rain >= 50);
  return (
    <div className={cn('rounded-[var(--lo-r-lg)] bg-[var(--lo-card)] p-4 shadow-[var(--lo-shadow)]', className)}>
      <div className="flex items-center gap-3">
        <WeatherArt code={weather.current.code} night={!weather.current.day} size={64} />
        <div className="min-w-0">
          <p className="num text-[26px] font-extrabold leading-8">{temp(weather.current.temp)}</p>
          <p className="truncate text-[13px] font-bold">{weatherWord(weather.current.code)}</p>
        </div>
        <div className="ml-auto text-right text-[12px] font-semibold leading-5 text-[var(--lo-ink-2)]">
          {d0 !== undefined && (
            <p className="num">
              {temp(d0.max)} / {temp(d0.min)}
            </p>
          )}
          <p>Feels {temp(weather.current.feels)}</p>
          <p className="flex items-center justify-end gap-1">
            <MapPin size={11} />
            {weather.place.city}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[13px] font-semibold text-[var(--lo-ink-2)]">{wet !== undefined ? `Rain likely around ${wet.time}` : d0 !== undefined && d0.uv >= 6 ? `Strong sun today (UV ${Math.round(d0.uv)})` : d0 !== undefined ? `Sunset at ${d0.sunset}` : ''}</p>
    </div>
  );
}

/** The next hours: time, drawing, temperature, chance of rain. */
export function HourStrip({ weather, hours = 10 }: { weather: Weather; hours?: number | undefined }): React.JSX.Element {
  return (
    <div className="flex gap-0.5 overflow-x-auto pb-1">
      {weather.hours.slice(0, hours).map((h, i) => (
        <div key={h.time + i} className={cn('flex min-w-[44px] flex-1 flex-col items-center rounded-[var(--lo-r)] py-2', i === 0 && 'bg-[var(--lo-sunk)]')}>
          <span className="text-[12px] font-bold text-[var(--lo-muted)]">{i === 0 ? 'Now' : h.time}</span>
          <WeatherArt code={h.code} night={!h.day} size={30} />
          <span className="num text-[13px] font-extrabold">{temp(h.temp)}</span>
          <span className={cn('num text-[12px] font-bold', h.rain >= 50 ? 'text-[var(--lo-art-sky-text)]' : 'text-[var(--lo-muted)]')}>{h.rain > 0 ? `${h.rain}%` : ''}</span>
        </div>
      ))}
    </div>
  );
}

/** The week ahead: each day's drawing, high and low drawn as a bar. */
export function WeatherWeek({ weather }: { weather: Weather }): React.JSX.Element {
  const lo = Math.min(...weather.days.map((d) => d.min));
  const hi = Math.max(...weather.days.map((d) => d.max));
  const span = Math.max(1, hi - lo);
  return (
    <ul className="flex flex-col">
      {weather.days.map((d, i) => (
        <li key={d.date} className="grid h-10 grid-cols-[56px_32px_36px_1fr_36px] items-center gap-2">
          <span className="text-[13px] font-bold">{i === 0 ? 'Today' : WD[parseDay(d.date).getDay()]}</span>
          <WeatherArt code={d.code} size={28} />
          <span className="num text-right text-[12px] font-bold text-[var(--lo-muted)]">{temp(d.min)}</span>
          <span className="relative h-1.5 rounded-full bg-[var(--lo-track)]" title={`${weatherWord(d.code)}, rain ${d.rain}%`}>
            <span className="absolute inset-y-0 rounded-full" style={{ left: `${((d.min - lo) / span) * 100}%`, right: `${100 - ((d.max - lo) / span) * 100}%`, background: 'linear-gradient(90deg, var(--lo-art-sky), var(--lo-art-honey))' }} />
          </span>
          <span className="num text-[13px] font-extrabold">{temp(d.max)}</span>
        </li>
      ))}
    </ul>
  );
}

/** No place yet: one field to say where you live. */
export function PlaceSearch({ onSet, compact = false }: { onSet?: ((p: Place) => void) | undefined; compact?: boolean | undefined }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async (): Promise<void> => {
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await op<{ places: Place[] }>('world.places', { q: q.trim() }, { quiet: true });
      setFound(r.places);
    } catch {
      setFound([]);
    } finally {
      setBusy(false);
    }
  };
  const pick = async (p: Place): Promise<void> => {
    await op('world.set-place', { city: p.city, region: p.region ?? '', country: p.country, lat: p.lat, lon: p.lon, timezone: p.timezone ?? '' });
    changed('settings');
    snack(`Weather for ${p.city}`, { undo: false });
    setFound(null);
    setQ('');
    onSet?.(p);
  };
  return (
    <div className={cn(!compact && 'rounded-[var(--lo-r-lg)] bg-[var(--lo-card)] p-4 shadow-[var(--lo-shadow)]')}>
      {!compact && (
        <div className="mb-2 flex items-center gap-2">
          <WeatherArt code={2} size={36} />
          <p className="text-[14px] font-bold">Where do you live? Your weather shows up here.</p>
        </div>
      )}
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} placeholder="Your town or city" aria-label="Town or city" className="h-10 min-w-0 flex-1 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[14px] font-semibold outline-none focus:border-[var(--lo-accent)]" />
        <button type="button" disabled={busy || q.trim().length < 2} onClick={() => void search()} className="h-10 shrink-0 rounded-[var(--lo-r)] bg-[var(--lo-primary)] px-4 text-[13px] font-extrabold text-white hover:bg-[var(--lo-primary-hover)] disabled:opacity-50">
          Find
        </button>
      </div>
      {found !== null && (
        <ul className="mt-2 flex flex-col">
          {found.length === 0 && <li className="px-2 py-2 text-[13px] text-[var(--lo-muted)]">No place by that name.</li>}
          {found.map((p) => (
            <li key={`${p.lat},${p.lon}`}>
              <button type="button" onClick={() => void pick(p)} className="flex h-9 w-full items-center gap-2 rounded-[var(--lo-r-sm)] px-2 text-left text-[14px] font-semibold hover:bg-[var(--lo-sunk)]">
                <MapPin size={14} className="text-[var(--lo-ink-2)]" />
                {p.city}
                <span className="truncate text-[12px] text-[var(--lo-muted)]">
                  {p.region !== undefined && p.region !== '' ? p.region + ', ' : ''}
                  {p.country}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ news */

const HOME_TOPICS = ['top', 'world', 'nation', 'business', 'technology', 'science', 'health', 'sports', 'entertainment'];

/** Headlines by topic, newest first; each opens the story. */
export function NewsList({ limit = 6, columns = false }: { limit?: number | undefined; columns?: boolean | undefined }): React.JSX.Element {
  const [topic, setTopic] = useState(() => {
    try {
      return localStorage.getItem('lo_news_topic') ?? 'top';
    } catch {
      return 'top';
    }
  });
  const { news, loading } = useNews(topic, limit);
  const choose = (t: string): void => {
    setTopic(t);
    try {
      localStorage.setItem('lo_news_topic', t);
    } catch {
      /* a convenience */
    }
  };
  return (
    <div>
      <div className="-mx-1 mb-2 flex gap-1 overflow-x-auto px-1 pb-1">
        {HOME_TOPICS.map((t) => (
          <Chip key={t} active={topic === t} onClick={() => choose(t)} className="h-7 px-2 text-[12px]">
            {TOPIC_NAMES[t] ?? t}
          </Chip>
        ))}
      </div>
      {loading && news === null ? (
        <div className="flex flex-col gap-3 py-1">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : news === null || news.items.length === 0 ? (
        <p className="py-3 text-[13px] text-[var(--lo-muted)]">The news is not reachable right now.</p>
      ) : (
        <ol className={cn(columns ? 'grid grid-cols-1 gap-x-8 md:grid-cols-2' : 'flex flex-col')}>
          {news.items.slice(0, limit).map((n, i) => (
            <li key={n.link}>
              <a href={n.link} target="_blank" rel="noreferrer" className={cn('group flex gap-3 rounded-[var(--lo-r-sm)] px-1 py-2 hover:bg-[var(--lo-sunk)]', columns ? 'border-t border-[var(--lo-hair)]' : i > 0 && 'border-t border-[var(--lo-hair)]')}>
                <span className="serif num w-5 shrink-0 text-right text-[15px] font-semibold text-[var(--lo-muted)]">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="serif block text-[15px] font-semibold leading-5 group-hover:underline">{n.title}</span>
                  <span className="mt-0.5 block text-[12px] font-semibold text-[var(--lo-muted)]">
                    {n.source}
                    {n.published !== '' ? ` · ${ago(n.published)}` : ''}
                  </span>
                </span>
                <ExternalLink size={13} className="mt-1 shrink-0 text-[var(--lo-muted)] opacity-0 group-hover:opacity-100" />
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- water */

/** Log the body (water, sleep, steps, weight, calm minutes): every place that shows it moves at once. */
export async function logHealth(p: Record<string, unknown>): Promise<void> {
  const day = typeof p.date === 'string' ? p.date : localDay();
  const num = (k: string): number => Number(p[k]);
  const next = (o: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (p.water !== undefined) out.water = num('water');
    if (p.add_water !== undefined) out.water = Math.max(0, Number(o.water) + num('add_water'));
    for (const k of ['sleep_h', 'steps', 'weight', 'mind_min']) if (p[k] !== undefined) out[k] = num(k);
    if (p.add_mind !== undefined) out.mind_min = Math.max(0, Number(o.mind_min) + num('add_mind'));
    return out;
  };
  const isLog = (o: Record<string, unknown>): boolean => o.date === day && typeof o.water === 'number' && typeof o.sleep_h === 'number' && typeof o.mind_min === 'number';
  // Habits that count themselves from water or calm minutes follow the body log.
  let water: number | null = null;
  let mind: number | null = null;
  const changes = [
    patchWhere(isLog, (o) => {
      const n = next(o);
      if (typeof n.water === 'number') water = n.water;
      if (typeof n.mind_min === 'number') mind = n.mind_min;
      return n;
    }),
    patchWhere(
      (o) => (o.source === 'water' || o.source === 'mind_min') && typeof o.today === 'object' && o.today !== null && day === localDay(),
      (o) => {
        const v = o.source === 'water' ? water : mind;
        if (v === null) return {};
        const t = o.today as Habit['today'];
        return { today: { ...t, value: v, done: v >= Number(o.target), skipped: false } };
      },
    ),
  ];
  await act(changes, () => op('health.log', p), ['health_logs', 'habits', 'habit_logs', 'goals', 'days']);
}

/** Glasses of water to tap: the next empty one fills, the last full one empties. */
export function WaterGlasses({ log, goal, size = 30 }: { log: HealthLog; goal: number; size?: number | undefined }): React.JSX.Element {
  const n = Math.max(goal, log.water);
  return (
    <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label={`Water: ${log.water} of ${goal} glasses`}>
      {Array.from({ length: n }, (_, i) => {
        const full = i < log.water;
        return (
          <button
            key={i}
            type="button"
            aria-label={full ? `Glass ${i + 1}: drunk. Tap to take back` : `Glass ${i + 1}`}
            onClick={(e) => {
              bounce(e.currentTarget);
              void logHealth({ water: full && i === log.water - 1 ? log.water - 1 : i + 1 });
            }}
            className={cn('hit-y rounded-[var(--lo-r-xs)] transition-transform hover:-translate-y-0.5', !full && 'opacity-30 grayscale hover:opacity-60')}
          >
            <HabitArt art="water" size={size} />
          </button>
        );
      })}
      <button type="button" aria-label="One more glass" onClick={() => void logHealth({ add_water: 1 })} className="hit-y ml-1 flex h-7 items-center rounded-[var(--lo-r-sm)] bg-[var(--lo-sunk)] px-2 text-[12px] font-extrabold text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk-hover)]">
        +1
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- money */

/** Type an amount, tap what it was for. */
export function QuickSpend({ categories = 6 }: { categories?: number | undefined }): React.JSX.Element {
  const s = useStatus().data;
  const [amount, setAmount] = useState('');
  const save = async (category: string): Promise<void> => {
    const a = amount.trim();
    if (a === '') return;
    setAmount('');
    snack(`Spent ${a} on ${SPEND_CATEGORIES.find((c) => c.key === category)?.label.toLowerCase() ?? category}`);
    // The month's numbers move at once (amounts are kept in minor units).
    const spent = (o: Record<string, unknown>): Record<string, unknown> => {
      const minor = Math.round(Number(a) * 10 ** Number(o.digits ?? 2));
      if (!Number.isFinite(minor)) return {};
      const cats = Array.isArray(o.by_category) ? (o.by_category as { category: string; amount: number }[]) : [];
      const has = cats.some((c) => c.category === category);
      return {
        spent: Number(o.spent) + minor,
        left: o.left === null || o.left === undefined ? o.left : Number(o.left) - minor,
        by_category: (has ? cats.map((c) => (c.category === category ? { ...c, amount: c.amount + minor } : c)) : [...cats, { category, amount: minor }]).sort((x, y) => y.amount - x.amount),
      };
    };
    const r = await act([patchWhere((o) => typeof o.spent === 'number' && Array.isArray(o.by_category) && 'budget' in o, spent)], () => op('money.add', { amount: a, category }), ['money_entries', 'goals', 'bills']);
    if (r === undefined) setAmount(a);
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold text-[var(--lo-muted)]">{s?.currency ?? ''}</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save('other')} inputMode="decimal" placeholder="0.00" aria-label="Amount spent" className="num h-10 w-28 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[15px] font-extrabold outline-none focus:border-[var(--lo-accent)]" />
        <span className="text-[12px] font-semibold text-[var(--lo-muted)]">{amount.trim() === '' ? 'Spent something?' : 'On what?'}</span>
      </div>
      <div className={cn('mt-2 flex flex-wrap gap-1.5 transition-opacity', amount.trim() === '' && 'pointer-events-none opacity-40')}>
        {SPEND_CATEGORIES.slice(0, categories).map((c) => (
          <button key={c.key} type="button" disabled={amount.trim() === ''} onClick={() => void save(c.key)} className="flex h-9 items-center gap-1.5 rounded-[var(--lo-r)] border border-[var(--lo-hair)] bg-[var(--lo-card)] pl-1 pr-2.5 text-[12px] font-bold hover:border-[var(--lo-line)]">
            <CategoryArt category={c.key} size={26} />
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ mood */

/** How a day feels: the sticker moves at once on every page that shows the day. */
export async function setMood(mood: number, date?: string | undefined): Promise<void> {
  const day = date ?? localDay();
  await act([patchWhere((o) => o.date === day && typeof o.mood === 'number' && !('body' in o), () => ({ mood }))], () => op('days.mood', date !== undefined ? { mood, date } : { mood }), ['days', 'journal_entries']);
}

/** Five stickers: how today feels. */
export function MoodPicker({ value, onPick, size = 44 }: { value: number; onPick?: ((m: number) => void) | undefined; size?: number | undefined }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label="How today feels" className="flex items-end gap-1.5">
      {[1, 2, 3, 4, 5].map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          aria-label={MOOD_WORDS[m - 1]}
          title={MOOD_WORDS[m - 1]}
          onClick={(e) => {
            bounce(e.currentTarget);
            if (onPick !== undefined) onPick(m);
            else void setMood(value === m ? 0 : m);
          }}
          className={cn('flex flex-col items-center gap-1 rounded-[var(--lo-r)] p-1 transition-transform', value === m ? 'scale-110 bg-[var(--lo-sunk)]' : value !== 0 ? 'opacity-45 hover:opacity-100' : 'hover:-translate-y-0.5')}
        >
          <MoodArt mood={m} size={size} />
          <span className="text-[12px] font-bold text-[var(--lo-ink-2)]">{MOOD_WORDS[m - 1]}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- people */

/** The people it is time to get in touch with (and whose birthday is near), each with "Talked". */
export function PeopleToReach({ due, birthdays, limit = 6 }: { due: Person[]; birthdays: Person[]; limit?: number | undefined }): React.JSX.Element | null {
  const panel = usePersonPanel();
  const today = useStatus().data?.today ?? '';
  const seen = new Set<string>();
  const list: { p: Person; why: string }[] = [];
  for (const p of birthdays.filter((b) => b.next_birthday !== null && b.next_birthday.in_days <= 14)) {
    seen.add(p.id);
    list.push({ p, why: p.next_birthday!.in_days === 0 ? 'Birthday today' : `Birthday ${relDay(p.next_birthday!.date, today)}` });
  }
  for (const p of due) if (!seen.has(p.id)) list.push({ p, why: p.days_since === null ? 'Not yet noted' : `${p.days_since} days` });
  if (list.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-4">
      {list.slice(0, limit).map(({ p, why }) => (
        <div key={p.id} className="flex flex-col items-center">
          <Face person={p} size={48} onClick={() => panel.open(p.id)} sub={why} />
          <button type="button" onClick={() => void touch(p)} className="mt-1 h-6 rounded-[var(--lo-r-sm)] bg-[var(--lo-moss-soft)] px-2 text-[12px] font-extrabold text-[var(--lo-moss-text)] hover:brightness-[0.97]">
            Talked today
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- coming up */

function comingArt(c: ComingItem): ReactNode {
  if (c.kind === 'birthday') return <ThingArt kind="cake" size={30} />;
  if (c.kind === 'bill') return <ThingArt kind="envelope" size={30} />;
  if (c.kind === 'trip') return <ThingArt kind="suitcase" size={30} />;
  if (c.kind === 'plan' && c.look !== undefined) return <Avatar look={c.look} size={30} />;
  return <ColumnArt kind="coming" size={30} />;
}

export function ComingUp({ items, today }: { items: ComingItem[]; today: string }): React.JSX.Element {
  if (items.length === 0) return <p className="text-[13px] text-[var(--lo-muted)]">A quiet week ahead.</p>;
  return (
    <ul className="relative flex flex-col gap-1 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-0.5 before:bg-[var(--lo-track)]">
      {items.slice(0, 8).map((c, i) => (
        <li key={c.kind + c.id + i} className="relative flex items-center gap-3 py-1">
          <span className="relative z-[1] rounded-full bg-[var(--lo-paper)]">{comingArt(c)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">{c.title}</span>
            <span className="block text-[12px] font-bold text-[var(--lo-muted)]">
              {relDay(c.date, today)}
              {c.time !== '' ? ` · ${c.time}` : ''}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
