/**
 * Mind: a month of moods as stickers (tap a day to set it), a breathing
 * circle to follow (the minutes are noted as calm time), and calm minutes
 * for the day.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, Square } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { useStatus } from '../../lib/context.tsx';
import { addMonths, MONTHS, parseDay, WD1 } from '../../lib/format.ts';
import { changed, useLive } from '../../lib/live.ts';
import type { HealthDay, MonthDay } from '../../lib/types.ts';
import { AreaArt, MOOD_WORDS, MoodArt } from '../art.tsx';
import { ColumnArt } from '../art2.tsx';
import { Panel } from '../panel.tsx';
import { logHealth, MoodPicker, setMood } from '../glance.tsx';
import { snack } from '../snack.tsx';
import { Popover, Skeleton } from '../ui.tsx';

function DayCell({ d, today }: { d: MonthDay; today: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const future = d.date > today;
  return (
    <>
      <button ref={ref} type="button" disabled={future} onClick={() => setOpen(true)} aria-label={`${d.date}${d.mood > 0 ? ': ' + MOOD_WORDS[d.mood - 1] : ''}`} className={cn('flex aspect-square flex-col items-center justify-center rounded-[var(--lo-r)] transition-colors', d.date === today ? 'bg-[var(--lo-k-mind-soft)] ring-2 ring-[var(--lo-k-mind)]' : 'hover:bg-[var(--lo-sunk)]', future && 'opacity-40')}>
        {d.mood > 0 ? <MoodArt mood={d.mood} size={30} /> : <span className="num text-[13px] font-bold text-[var(--lo-muted)]">{parseDay(d.date).getDate()}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} className="p-2">
        <MoodPicker
          value={d.mood}
          size={36}
          onPick={(m) => {
            setOpen(false);
            void setMood(d.mood === m ? 0 : m, d.date);
          }}
        />
      </Popover>
    </>
  );
}

function MoodMonth(): React.JSX.Element {
  const today = useStatus().data?.today ?? '';
  const [month, setMonth] = useState(today.slice(0, 7));
  const live = useLive<{ days: MonthDay[]; week_starts_on: number; month: string }>((signal) => op('days.month', { month }, { quiet: true, signal }), ['days', 'journal_entries'], [month]);
  const d = live.data;
  if (d === null) return <Skeleton className="h-72 w-full" />;
  const ws = d.week_starts_on;
  const first = parseDay(d.days[0]?.date ?? month + '-01').getDay();
  const pad = (first - ws + 7) % 7;
  const counts = [1, 2, 3, 4, 5].map((m) => d.days.filter((x) => x.mood === m).length);
  const noted = counts.reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <button type="button" aria-label="Last month" onClick={() => setMonth(addMonths(month + '-01', -1).slice(0, 7))} className="flex size-8 items-center justify-center rounded-[var(--lo-r-sm)] hover:bg-[var(--lo-sunk)]">
          <ChevronLeft size={16} />
        </button>
        <p className="serif min-w-0 flex-1 text-center text-[15px] font-semibold">
          {MONTHS[parseDay(month + '-01').getMonth()]} {month.slice(0, 4)}
        </p>
        <button type="button" aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(addMonths(month + '-01', 1).slice(0, 7))} className="flex size-8 items-center justify-center rounded-[var(--lo-r-sm)] hover:bg-[var(--lo-sunk)] disabled:opacity-30">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="text-center text-[12px] font-bold text-[var(--lo-muted)]">
            {WD1[(i + ws) % 7]}
          </span>
        ))}
        {Array.from({ length: pad }, (_, i) => (
          <span key={'p' + i} />
        ))}
        {d.days.map((x) => (
          <DayCell key={x.date} d={x} today={today} />
        ))}
      </div>
      {noted > 0 && (
        <div className="mt-3 flex items-center gap-3 border-t border-[var(--lo-hair)] pt-3">
          {counts.map((n, i) => (
            <span key={i} className={cn('flex items-center gap-1 text-[12px] font-bold', n === 0 && 'opacity-40')}>
              <MoodArt mood={i + 1} size={20} />
              <span className="num">{n}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const PHASES = [
  { at: 0, word: 'Breathe in' },
  { at: 4, word: 'Hold' },
  { at: 5.5, word: 'Breathe out' },
];

function Breathing(): React.JSX.Element {
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (start === null) return;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [start]);
  const t = start === null ? 0 : ((now - start) / 1000) % 10;
  const word = start === null ? 'Ready' : ([...PHASES].reverse().find((p) => t >= p.at)?.word ?? '');
  const secs = start === null ? 0 : Math.floor((now - start) / 1000);
  const stop = (): void => {
    if (start === null) return;
    const m = Math.round((Date.now() - start) / 60000);
    setStart(null);
    if (m >= 1) {
      void logHealth({ add_mind: m }).then(() => snack(`${m} calm minute${m === 1 ? '' : 's'} noted`));
    }
  };
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex size-[220px] items-center justify-center">
        <span aria-hidden className="absolute inset-0 rounded-full bg-[var(--lo-k-mind-soft)]" />
        <span aria-hidden className={cn('absolute inset-3 rounded-full bg-[var(--lo-art-lavender)] opacity-80', start !== null ? 'lo-breathe' : 'scale-[0.62]')} />
        <span className="relative text-center">
          <span className="serif block text-[15px] font-semibold">{word}</span>
          {start !== null && (
            <span className="num block text-[12px] font-bold text-[var(--lo-ink-2)]">
              {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
            </span>
          )}
        </span>
      </div>
      {start === null ? (
        <button type="button" onClick={() => setStart(Date.now())} className="flex h-10 items-center gap-2 rounded-[var(--lo-r)] bg-[var(--lo-primary)] px-5 text-[14px] font-extrabold text-white hover:bg-[var(--lo-primary-hover)]">
          <Play size={15} fill="currentColor" /> Breathe with it
        </button>
      ) : (
        <button type="button" onClick={stop} className="flex h-10 items-center gap-2 rounded-[var(--lo-r)] bg-[var(--lo-sunk)] px-5 text-[14px] font-extrabold hover:bg-[var(--lo-sunk-hover)]">
          <Square size={13} /> Stop
        </button>
      )}
    </div>
  );
}

export default function MindTool(): React.JSX.Element {
  const day = useLive<HealthDay>((signal) => op('health.day', {}, { quiet: true, signal }), ['health_logs'], []);
  const mood = useLive<{ day: { mood: number } }>((signal) => op('days.get', {}, { quiet: true, signal }), ['days'], []);
  const calm = day.data?.log.mind_min ?? 0;
  return (
    <>
      <Panel title="How are you today?" art={<MoodArt mood={4} size={24} />}>
        <MoodPicker value={mood.data?.day.mood ?? 0} />
      </Panel>
      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
        <Panel title="A month of moods" art={<ColumnArt kind="coming" size={24} />}>
          <MoodMonth />
        </Panel>
        <Panel title="Breathe" art={<AreaArt kind="mind" size={26} />} note={`${calm} calm min today`}>
          <Breathing />
          <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5 border-t border-[var(--lo-hair)] pt-4">
            <span className="mr-1 text-[12px] font-bold text-[var(--lo-muted)]">Other quiet time</span>
            {[5, 10, 20].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  void logHealth({ add_mind: m }).then(() => {
                    changed('health_logs');
                    snack(`${m} calm minutes noted`);
                  });
                }}
                className="h-9 rounded-[var(--lo-r-sm)] bg-[var(--lo-k-mind-soft)] px-3 text-[13px] font-extrabold text-[var(--lo-k-mind-text)] hover:brightness-[0.97]"
              >
                +{m} min
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
