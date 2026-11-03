/**
 * Today: the plan for the day and how practice is going. The plan is the
 * hero (start it, or any block of it); around it the week as a dial, the
 * numbers that matter, thirty days of minutes and accuracy, the songs in
 * progress with their sections, the calendar, and the coach.
 */
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, BookOpen, Sparkle, Check, Dumbbell, Flame, Footprints, Headphones, Library, Play, Send } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { goPractice, openBlock } from '../App.tsx';
import { CountUp, HeatDots, MiniRoll, PracticeChart, Ring, Sparkline, WeekDial } from '../components/charts.tsx';
import { Button, Empty, Input, PageHeader, Panel, Spinner, StageDots, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, bars as barsText, levelName, minutes as fmtMinutes, pad2 } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { href, navigate } from '../lib/router.ts';
import type { Home, Mode, Plan, PlanBlock, Song, Stage } from '../lib/types.ts';

const MODE_ICON: Record<Mode, LucideIcon> = { listen: Headphones, learn: Footprints, play: Play };
const WHY: Record<string, string> = { 'warm-up': 'Warm-up', review: 'Review', climb: 'Climb', polish: 'Polish', run: 'Run-through', new: 'New' };

export function TodayPage(): React.JSX.Element {
  const app = useApp();
  const home = useLive(() => api.home(), ['runs', 'songs', 'progress', 'messages', 'settings', 'sessions'], [], 200, 1500);
  const plan = useLive(() => api.plan(), ['plans', 'songs', 'progress', 'settings', 'runs'], [], 200, 1500);
  const h = home.data;
  const date = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <div className="pc-scroll h-full overflow-y-auto">
      <PageHeader title="Today" meta={date}>
        <Button variant="primary" size="lg" icon={Play} onClick={() => void goPractice(app.settings?.last_song ?? '')}>
          Practice
        </Button>
      </PageHeader>
      {h === null ? (
        <div className="flex h-[60vh] items-center justify-center text-[var(--pc-muted)]">
          <Spinner size={18} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 px-5 pb-8 pt-3 md:px-7 lg:grid-cols-12">
          <PlanPanel plan={plan.data?.plan ?? null} className="lg:col-span-7" />
          <WeekPanel home={h} className="lg:col-span-5" />
          <Kpis home={h} className="lg:col-span-12" />
          <Panel index="04" label="Practice · 30 days" className="lg:col-span-8" aside={<Legend />}>
            <PracticeChart series={h.series} goal={h.goal} />
          </Panel>
          <CoachPanel home={h} className="lg:col-span-4" />
          <ProgressPanel home={h} className="lg:col-span-7" />
          <Panel index="07" label="Calendar" className="lg:col-span-5" aside={<span className="pc-label">18 weeks</span>}>
            <div className="flex h-full items-center justify-center overflow-x-auto py-2">
              <HeatDots days={h.heat} goal={h.goal} />
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function Legend(): React.JSX.Element {
  return (
    <span className="pc-label flex items-center gap-3">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-1.5 rounded-[1px] bg-[var(--pc-ink)]" /> min
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full border-[1.5px] border-[var(--pc-rh)]" /> accuracy
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ plan */

function PlanPanel({ plan, className }: { plan: Plan | null; className?: string }): React.JSX.Element {
  const app = useApp();
  const start = async (b: PlanBlock): Promise<void> => {
    try {
      if (plan?.status === 'proposed') await api.startPlan();
    } catch (err) {
      toast.error(errMessage(err));
    }
    openBlock(b);
  };
  const coach = plan?.source === 'coach';
  return (
    <Panel
      index="01"
      label={plan === null ? 'Plan' : `Plan · ${plan.minutes} min`}
      className={cn('min-h-[300px]', className)}
      aside={
        coach ? (
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-[var(--pc-coach-soft)] px-2 text-[11px] font-medium text-[var(--pc-coach)]">
            <Sparkle size={11} aria-hidden /> Coach
          </span>
        ) : plan !== null && plan.done > 0 ? (
          <span className="pc-label">
            {plan.done}/{plan.blocks.length} done
          </span>
        ) : undefined
      }
      bodyClass="flex flex-col"
    >
      {plan === null ? (
        <div className="flex flex-1 items-center justify-center text-[var(--pc-muted)]">
          <Spinner />
        </div>
      ) : plan.blocks.length === 0 ? (
        <Empty icon={Library} title="Nothing to plan yet" action={<Button icon={Library} onClick={() => navigate('library')}>Open the library</Button>} className="flex-1" />
      ) : (
        <>
          {plan.note !== '' && (
            <p className={cn('mb-2 rounded-[var(--pc-radius-sm)] px-3 py-2 text-[12.5px] leading-[18px]', coach ? 'border-l-2 border-[var(--pc-coach)] bg-[var(--pc-coach-soft)] text-[var(--pc-ink)]' : 'bg-[var(--pc-sunk)] text-[var(--pc-ink-2)]')}>{plan.note}</p>
          )}
          <ol className="flex flex-col">
            {plan.blocks.map((b, i) => {
              const Icon = b.kind === 'lesson' ? BookOpen : b.kind === 'drill' ? Dumbbell : MODE_ICON[b.mode];
              const song = b.kind === 'song';
              return (
                <li key={b.i} className="pc-in" style={{ animationDelay: `${i * 40}ms` }}>
                  <button
                    type="button"
                    onClick={() => void start(b)}
                    className={cn('pc-focus group flex w-full items-center gap-3 rounded-[var(--pc-radius-sm)] border-b border-[var(--pc-hair)] px-1.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[var(--pc-hover)]', b.done && 'opacity-55')}
                  >
                    <span className="pc-mono w-5 shrink-0 text-[11px] text-[var(--pc-faint)]">{pad2(i + 1)}</span>
                    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full border', b.done ? 'border-[var(--pc-ink)] bg-[var(--pc-ink)] text-[var(--pc-page)]' : 'border-[var(--pc-line-2)] text-[var(--pc-ink-2)]')}>{b.done ? <Check size={13} strokeWidth={2.5} aria-hidden /> : <Icon size={13} strokeWidth={1.9} aria-hidden />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{b.title}</span>
                      <span className="block truncate text-[12px] text-[var(--pc-muted)]">
                        {!song ? (b.kind === 'lesson' ? 'Lesson' : 'Drill') : b.whole ? 'Whole piece' : b.section !== null && b.section !== '' ? `${b.section} · ${barsText(b.from, b.to)}` : barsText(b.from, b.to)}
                        {song && b.hands !== 'both' && !/hand/i.test(b.section ?? '') ? ` · ${b.hands} hand` : ''}
                      </span>
                    </span>
                    <span className="pc-label hidden shrink-0 sm:inline">{WHY[b.why] ?? ''}</span>
                    <span className="pc-mono pc-num w-11 shrink-0 text-right text-[12px] text-[var(--pc-ink-2)]">{song ? `${b.tempo}%` : ''}</span>
                    <span className="pc-mono pc-num w-12 shrink-0 text-right text-[12px]">{b.minutes} min</span>
                    <ArrowRight size={14} aria-hidden className="shrink-0 text-[var(--pc-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--pc-ink)]" />
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-auto flex items-center gap-2 pt-3">
            {plan.source === 'coach' && (
              <Button variant="ghost" size="sm" onClick={() => void api.resetPlan().catch((err: unknown) => toast.error(errMessage(err)))}>
                Use the app’s plan
              </Button>
            )}
            <span className="flex-1" />
            {plan.done < plan.blocks.length && (
              <Button variant="primary" icon={Play} onClick={() => void goPractice(app.settings?.last_song ?? '')}>
                {plan.done > 0 ? 'Continue' : 'Start'}
              </Button>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ week */

function WeekPanel({ home, className }: { home: Home; className?: string }): React.JSX.Element {
  return (
    <Panel index="02" label="This week" className={className} bodyClass="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
      <WeekDial week={home.week} goal={home.goal} today={home.today.minutes} size={232} />
      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <div className="pc-label">Today</div>
          <div className="pc-mono pc-num text-[34px] font-light leading-none tracking-tight">
            <CountUp value={home.today.minutes} />
            <span className="text-[15px] text-[var(--pc-muted)]">/{home.goal} min</span>
          </div>
        </div>
        <div>
          <div className="pc-label">Streak</div>
          <div className="mt-1 flex items-center gap-1.5 text-[15px] font-semibold">
            <Flame size={16} aria-hidden className={home.streak > 0 ? 'text-[var(--pc-warn)]' : 'text-[var(--pc-faint)]'} />
            <span className="pc-mono pc-num">{home.streak}</span>
            <span className="text-[13px] font-normal text-[var(--pc-muted)]">{home.streak === 1 ? 'day' : 'days'}</span>
          </div>
        </div>
        <div>
          <div className="pc-label">Level</div>
          <div className="mt-1 text-[13.5px] font-medium">
            <span className="pc-mono mr-1.5">{pad2(home.level)}</span>
            {levelName(home.level)}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ KPIs */

function Delta({ now, before, unit }: { now: number | null; before: number | null; unit: '%' | 'min' }): React.JSX.Element | null {
  if (now === null || before === null || before === 0) return null;
  const d = unit === '%' ? Math.round((now - before) * 100) : Math.round(((now - before) / before) * 100);
  if (d === 0) return null;
  return <span className={cn('pc-mono text-[11px]', d > 0 ? 'text-[var(--pc-good)]' : 'text-[var(--pc-bad)]')}>{(d > 0 ? '+' : '') + d + (unit === '%' ? ' pt' : '%')}</span>;
}

function Kpis({ home, className }: { home: Home; className?: string }): React.JSX.Element {
  const t = home.totals;
  const minutes = home.series.slice(-14).map((s) => s.minutes);
  const acc = home.series.map((s) => s.accuracy).filter((a): a is number => a !== null);
  const tiles: { label: string; value: React.ReactNode; aside?: React.ReactNode; chart?: React.ReactNode }[] = [
    { label: 'Minutes · 7d', value: <CountUp value={t.minutes_7} />, aside: <Delta now={t.minutes_7} before={t.minutes_prev_7} unit="min" />, chart: <Sparkline values={minutes} /> },
    { label: 'Accuracy · 7d', value: t.accuracy_7 === null ? '—' : <><CountUp value={Math.round(t.accuracy_7 * 100)} />%</>, aside: <Delta now={t.accuracy_7} before={t.accuracy_prev_7} unit="%" />, chart: <Sparkline values={acc.slice(-14)} color="var(--pc-rh)" /> },
    { label: 'Sections mastered', value: <CountUp value={t.sections.mastered} />, aside: <span className="pc-mono text-[11px] text-[var(--pc-muted)]">{t.sections.steady} steady</span> },
    { label: 'Due for review', value: <CountUp value={t.due} />, aside: <span className="pc-mono text-[11px] text-[var(--pc-muted)]">{t.songs_mastered} songs mastered</span> },
  ];
  return (
    <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-4', className)}>
      {tiles.map((k, i) => (
        <div key={k.label} className="pc-panel pc-in flex items-end justify-between gap-2 px-3.5 py-3" style={{ animationDelay: `${i * 50}ms` }}>
          <div className="min-w-0">
            <div className="pc-label truncate">
              <span className="mr-2 text-[var(--pc-faint)]">0{3}.{i + 1}</span>
              {k.label}
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="pc-mono pc-num text-[26px] font-light leading-none tracking-tight">{k.value}</span>
              {k.aside}
            </div>
          </div>
          {k.chart !== undefined && <span className="hidden shrink-0 sm:block">{k.chart}</span>}
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- coach */

function CoachPanel({ home, className }: { home: Home; className?: string }): React.JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = (): void => {
    if (text.trim() === '') return;
    setBusy(true);
    api
      .send({ text: text.trim(), context: { view: 'today' } })
      .then((r) => {
        setText('');
        if (r.asked) toast.success('Sent to your coach');
        else toast.info(`Saved. ${r.reason}`);
      })
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setBusy(false));
  };
  const c = home.coach;
  return (
    <Panel index="05" label="Coach" className={className} aside={home.unread > 0 ? <span className="pc-label text-[var(--pc-coach)]">{home.unread} new</span> : undefined} bodyClass="flex flex-col gap-3">
      {c !== null ? (
        <a href={href('coach')} className="pc-focus group flex flex-1 gap-2.5 rounded-[var(--pc-radius-sm)] p-1 transition-colors hover:bg-[var(--pc-hover)]">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--pc-coach)] text-[var(--pc-coach-ink)]">
            <Sparkle size={15} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="pc-label block">{c.kind === 'review' ? 'Session review' : 'Reply'} · {ago(c.created)}</span>
            <span className="mt-1 line-clamp-5 block text-[13px] leading-5 text-[var(--pc-ink-2)]">{c.text}</span>
          </span>
        </a>
      ) : (
        <div className="flex flex-1 items-center gap-2.5 text-[13px] text-[var(--pc-muted)]">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--pc-coach)] text-[var(--pc-coach-ink)]">
            <Sparkle size={15} aria-hidden />
          </span>
          Ask for a song to learn, or anything about practice.
        </div>
      )}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add Clair de Lune, simplified…" aria-label="Message to your coach" />
        <Button type="submit" variant="coach" icon={Send} busy={busy} disabled={text.trim() === ''} aria-label="Send" />
      </form>
    </Panel>
  );
}

/* -------------------------------------------------------------- progress */

const STAGE_FILL: Record<Stage, string> = {
  new: 'var(--pc-line)',
  learning: 'color-mix(in srgb, var(--pc-ink) 35%, var(--pc-line))',
  steady: 'color-mix(in srgb, var(--pc-ink) 70%, var(--pc-line))',
  mastered: 'var(--pc-ink)',
};

export function SectionBars({ song, height = 6 }: { song: Song; height?: number }): React.JSX.Element {
  const total = song.sections.reduce((a, s) => a + (s.to - s.from + 1), 0) || 1;
  return (
    <span className="flex w-full gap-[2px]" style={{ height }}>
      {song.sections.map((s) => (
        <span key={s.i} title={`${s.name} · ${s.stage}${s.best > 0 ? ` · ${s.best}%` : ''}`} className="rounded-[2px] transition-[background-color] duration-500" style={{ flex: s.to - s.from + 1, background: STAGE_FILL[s.stage] }} />
      ))}
      {song.sections.length === 0 && <span className="flex-1 rounded-[2px] bg-[var(--pc-line)]" style={{ flex: total }} />}
    </span>
  );
}

function ProgressPanel({ home, className }: { home: Home; className?: string }): React.JSX.Element {
  const list = home.current.length > 0 ? home.current : home.resume !== null ? [home.resume] : [];
  return (
    <Panel index="06" label="In progress" className={className} aside={<a href={href('library')} className="pc-label hover:text-[var(--pc-ink)]">Library</a>}>
      {list.length === 0 ? (
        <Empty icon={Library} title="No song started yet" action={<Button icon={Library} onClick={() => navigate('library')}>Choose a song</Button>} className="py-6" />
      ) : (
        <ul className="flex flex-col">
          {list.map((s, i) => (
            <li key={s.id} className="pc-in" style={{ animationDelay: `${i * 50}ms` }}>
              <a href={href('practice', { song: s.id })} className="pc-focus group flex items-center gap-3 border-b border-[var(--pc-hair)] px-1 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--pc-hover)]">
                <span className="w-[88px] shrink-0 overflow-hidden rounded-[4px] border border-[var(--pc-hair)] bg-[var(--pc-raised)]">
                  <MiniRoll preview={s.preview} height={34} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium">{s.title}</span>
                    <span className="pc-label hidden truncate sm:inline">{s.composer}</span>
                  </span>
                  <span className="mt-1.5 block">
                    <SectionBars song={s} />
                  </span>
                </span>
                <span className="hidden shrink-0 text-right sm:block">
                  <span className="pc-label block">{s.progress.last_at !== '' ? ago(s.progress.last_at) : ''}</span>
                  <span className="pc-mono block text-[11px] text-[var(--pc-muted)]">{fmtMinutes(s.progress.minutes)}</span>
                </span>
                <Ring value={s.progress.pct} size={32}>
                  <span className="pc-mono text-[9px]">{Math.round(s.progress.pct * 100)}</span>
                </Ring>
              </a>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && (
        <div className="mt-2 flex items-center gap-3 px-1">
          {(['learning', 'steady', 'mastered'] as Stage[]).map((st) => (
            <span key={st} className="pc-label flex items-center gap-1.5">
              <StageDots stage={st} size={5} /> {st}
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}
