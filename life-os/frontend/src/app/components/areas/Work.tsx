/**
 * Work: a focus timer (it keeps running when you leave the page, and the
 * minutes are noted when it rings), the week's focus as bars, and wins,
 * written down as they happen.
 */
import { useEffect, useState } from 'react';
import { Pause, Play, Square, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { useStatus } from '../../lib/context.tsx';
import { minutes, parseDay, relDay, WD1 } from '../../lib/format.ts';
import { act, changed, drop, insert, localDay, patch, tempId, useLive } from '../../lib/live.ts';
import { enter, rowOf, vanish } from '../../lib/motion.ts';
import type { FocusWeek, Task, Win } from '../../lib/types.ts';
import { ColumnArt, ThingArt } from '../art2.tsx';
import { AddLine, Chip } from '../bits.tsx';
import { Panel } from '../panel.tsx';
import { Bars } from '../charts.tsx';
import { snack } from '../snack.tsx';
import { Skeleton } from '../ui.tsx';

interface Timer {
  minutes: number;
  ends: number | null;
  left: number;
  task: string;
}

const KEY = 'lo_focus_timer';

function loadTimer(): Timer | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : (JSON.parse(raw) as Timer);
  } catch {
    return null;
  }
}

function saveTimer(t: Timer | null): void {
  try {
    if (t === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* the timer still runs on this page */
  }
}

async function logFocus(m: number, task: string): Promise<void> {
  if (m < 1) return;
  await op('focus.log', task !== '' ? { minutes: m, task } : { minutes: m });
  changed('focus_sessions', 'goals');
  snack(`${minutes(m)} of focus noted`);
}

function FocusTimer({ tasks }: { tasks: Task[] }): React.JSX.Element {
  const [t, setT] = useState<Timer | null>(loadTimer);
  const [preset, setPreset] = useState(25);
  const [task, setTask] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (t === null || t.ends === null) return;
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, [t]);
  const left = t === null ? preset * 60 : t.ends !== null ? Math.max(0, Math.round((t.ends - now) / 1000)) : t.left;
  useEffect(() => {
    if (t !== null && t.ends !== null && left === 0) {
      const done = t;
      setT(null);
      saveTimer(null);
      void logFocus(done.minutes, done.task);
    }
  }, [left, t]);
  const set = (n: Timer | null): void => {
    setT(n);
    saveTimer(n);
  };
  const start = (): void => set({ minutes: preset, ends: Date.now() + preset * 60000, left: preset * 60, task });
  const pause = (): void => {
    if (t === null || t.ends === null) return;
    set({ ...t, ends: null, left });
  };
  const resume = (): void => {
    if (t === null) return;
    set({ ...t, ends: Date.now() + t.left * 1000 });
  };
  const stop = (): void => {
    if (t === null) return;
    const spent = Math.floor((t.minutes * 60 - left) / 60);
    set(null);
    void logFocus(spent, t.task);
  };
  const total = (t?.minutes ?? preset) * 60;
  const frac = total > 0 ? left / total : 0;
  const R = 92;
  const C = 2 * Math.PI * R;
  const running = t !== null && t.ends !== null;
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative flex size-[210px] shrink-0 items-center justify-center">
        <svg width={210} height={210} className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx={105} cy={105} r={R} fill="var(--lo-sunk)" stroke="var(--lo-track)" strokeWidth={12} />
          <circle cx={105} cy={105} r={R} fill="none" stroke="var(--lo-k-work)" strokeWidth={12} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} style={{ transition: 'stroke-dashoffset 500ms linear' }} />
        </svg>
        <div className="relative flex flex-col items-center">
          <ThingArt kind="timer" size={40} />
          <span className="num mt-1 text-[26px] font-extrabold leading-8" aria-live="polite">
            {mm}:{ss}
          </span>
          <span className="text-[12px] font-bold text-[var(--lo-muted)]">{t === null ? 'Ready' : running ? 'Focusing' : 'Paused'}</span>
        </div>
      </div>
      <div className="flex w-full min-w-0 flex-1 flex-col gap-3">
        {t === null && (
          <div className="flex flex-wrap gap-1.5">
            {[15, 25, 50, 90].map((m) => (
              <Chip key={m} active={preset === m} onClick={() => setPreset(m)}>
                {minutes(m)}
              </Chip>
            ))}
          </div>
        )}
        {tasks.length > 0 && t === null && (
          <select value={task} onChange={(e) => setTask(e.target.value)} aria-label="On what" className="h-9 w-full max-w-sm min-w-0 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-2 text-[13px] font-bold outline-none focus:border-[var(--lo-accent)]">
            <option value="">On anything</option>
            {tasks.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        )}
        {t !== null && t.task !== '' && <p className="text-[13px] font-semibold text-[var(--lo-ink-2)]">On: {tasks.find((x) => x.id === t.task)?.title ?? 'a card'}</p>}
        <div className="flex gap-2">
          {t === null ? (
            <button type="button" onClick={start} className="flex h-11 items-center gap-2 rounded-[var(--lo-r)] bg-[var(--lo-primary)] px-5 text-[15px] font-extrabold text-white hover:bg-[var(--lo-primary-hover)]">
              <Play size={16} fill="currentColor" /> Start
            </button>
          ) : (
            <>
              {running ? (
                <button type="button" onClick={pause} className="flex h-11 items-center gap-2 rounded-[var(--lo-r)] bg-[var(--lo-sunk)] px-4 text-[14px] font-extrabold hover:bg-[var(--lo-sunk-hover)]">
                  <Pause size={16} /> Pause
                </button>
              ) : (
                <button type="button" onClick={resume} className="flex h-11 items-center gap-2 rounded-[var(--lo-r)] bg-[var(--lo-primary)] px-4 text-[14px] font-extrabold text-white hover:bg-[var(--lo-primary-hover)]">
                  <Play size={16} fill="currentColor" /> Go on
                </button>
              )}
              <button type="button" onClick={stop} className="flex h-11 items-center gap-2 rounded-[var(--lo-r)] px-4 text-[14px] font-bold text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk)]">
                <Square size={14} /> Stop and note it
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkTool(): React.JSX.Element {
  const today = useStatus().data?.today ?? '';
  const week = useLive<FocusWeek>((signal) => op('focus.week', {}, { quiet: true, signal }), ['focus_sessions'], []);
  const wins = useLive<{ wins: Win[] }>((signal) => op('wins.list', { limit: 12 }, { quiet: true, signal }), ['wins'], []);
  const tasks = useLive<{ tasks: Task[] }>((signal) => op('tasks.list', { area: 'work', column: 'today' }, { quiet: true, signal }), ['tasks'], []);
  const w = week.data;
  return (
    <>
      <Panel title="Focus" art={<ThingArt kind="timer" size={24} />}>
        <FocusTimer tasks={(tasks.data?.tasks ?? []).filter((t) => t.state === 'open')} />
      </Panel>
      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
        {w === null ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <Panel title="This week" art={<ColumnArt kind="coming" size={24} />} note={minutes(w.total) || '0 min'}>
            <Bars values={w.days.map((d) => d.minutes)} labels={w.days.map((d) => d.date)} color="var(--lo-k-work)" height={80} highlight={w.days.findIndex((d) => d.date === today)} format={(v) => minutes(v) || '0'} />
            <div className="mt-1 flex gap-[3px]">
              {w.days.map((d) => (
                <span key={d.date} className={cn('min-w-0 flex-1 text-center text-[12px] font-bold', d.date === today ? 'text-[var(--lo-ink)]' : 'text-[var(--lo-muted)]')}>
                  {WD1[parseDay(d.date).getDay()]}
                </span>
              ))}
            </div>
          </Panel>
        )}
      <Panel title="Wins" art={<ThingArt kind="trophy" size={24} />} bodyClassName="p-3 md:p-4">
        <AddLine
          placeholder="A win, big or small"
          onAdd={async (text) => {
            const draft = { id: tempId(), text, area: 'work', date: localDay(), actor: 'person' } as unknown as Win;
            const r = await act([insert((k) => k === 'wins', draft, 'start')], () => op('wins.add', { text, area: 'work' }), ['wins', 'goals']);
            if (r === undefined) return false;
            snack('Win noted');
            return true;
          }}
        />
        <ul className="mt-2 flex flex-col">
          {(wins.data?.wins ?? []).map((x) => (
            <li key={x.id} data-row className={cn('group flex min-h-11 items-center gap-3 rounded-[var(--lo-r-sm)] px-2 hover:bg-[var(--lo-sunk)]', enter(x.id))}>
              <ThingArt kind="star" size={24} />
              <span className="min-w-0 flex-1 text-[14px] font-semibold">{x.text}</span>
              <span className="shrink-0 text-[12px] font-bold text-[var(--lo-muted)]">{relDay(x.date, today)}</span>
              <button
                type="button"
                aria-label="Remove"
                onClick={(e) => {
                  void vanish(rowOf(e), [drop(x.id)], () => op('wins.delete', { win: x.id }), ['wins', 'goals']).then((r) => r !== undefined && snack('Removed'));
                }}
                className="hit flex size-7 items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-muted)] opacity-0 hover:bg-[var(--lo-card)] focus:opacity-100 group-hover:opacity-100"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
        {(wins.data?.wins ?? []).length === 0 && <p className="px-2 pt-2 text-[13px] text-[var(--lo-muted)]">Write them down as they happen. They make the hard weeks easier.</p>}
      </Panel>
      </div>
    </>
  );
}
