/**
 * Today: the plan for the day and how the voice is doing. The plan is the
 * hero (start it, or any block of it): warm-up first, cool-down last, split
 * into two sittings when it is longer than the session cap. Around it the
 * week as a dial, the numbers that matter for a singer (on pitch, in tune,
 * steadiness, comfortable range, voice load, the last voice check), thirty
 * days of voiced minutes and pitch, the voice map of the week, the songs in
 * progress, the calendar with its rest days, and the coach.
 */
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, BedDouble, BookOpen, Check, Dumbbell, Ear, Flame, HeartPulse, Headphones, Library, Mic, Moon, Music2, Play, Send, Sparkle, Stethoscope, Waves, Wind } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { goPractice, openBlock } from '../App.tsx';
import { CheckInDialog } from '../components/CheckIn.tsx';
import { Contour, CountUp, HeatDots, PracticeChart, Ring, Sparkline, VoiceMap, WeekDial } from '../components/charts.tsx';
import { Button, Empty, Input, PageHeader, Panel, Spinner, StageDots, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, bars as barsText, levelName, minutes as fmtMinutes, pad2 } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { href, navigate } from '../lib/router.ts';
import type { Home, Mode, Plan, PlanBlock, Song, Stage } from '../lib/types.ts';
import { noteLabel } from '../music/dial.ts';

const MODE_ICON: Record<Mode, LucideIcon> = { listen: Headphones, echo: Ear, sing: Music2, solo: Mic };
const KIND_ICON: Record<string, LucideIcon> = { warmup: Wind, cooldown: Moon, exercise: Waves, lesson: BookOpen, drill: Dumbbell };
const KIND_LABEL: Record<string, string> = { warmup: 'Warm-up', cooldown: 'Cool-down', exercise: 'Vocalise', lesson: 'Lesson', drill: 'Drill' };

export function TodayPage(): React.JSX.Element {
  const app = useApp();
  const home = useLive(() => api.home(), ['runs', 'songs', 'progress', 'messages', 'settings', 'sessions', 'voice', 'checkins', 'drills'], [], 200, 1500);
  const plan = useLive(() => api.plan(), ['plans', 'songs', 'progress', 'settings', 'runs', 'checkins', 'lessons', 'skills'], [], 200, 1500);
  const [checkin, setCheckin] = useState(false);
  const h = home.data;
  const date = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <div className="sc-scroll h-full overflow-y-auto">
      <PageHeader title="Today" meta={date}>
        {h !== null && (
          <span className="hidden items-center gap-2.5 rounded-full border border-[var(--sc-line)] bg-[var(--sc-raised)] py-1 pl-1.5 pr-3 lg:flex" title={`${h.level_met} of ${h.level_total} requirements of level ${h.level} met`}>
            <Ring value={h.level_total > 0 ? h.level_met / h.level_total : 0} size={24} stroke={2.5} />
            <span className="text-[12.5px]">
              Level {h.level} · {h.level_name || levelName(h.level)}
            </span>
          </span>
        )}
        <Button variant="primary" size="lg" icon={Play} onClick={() => void goPractice(app.settings?.last_song ?? '')}>
          Start
        </Button>
      </PageHeader>
      {h === null ? (
        <div className="flex h-[60vh] items-center justify-center text-[var(--sc-muted)]">
          <Spinner size={18} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 px-5 pb-8 pt-3 md:px-7 lg:grid-cols-12">
          <HealthBanner home={h} className="lg:col-span-12" />
          <PlanPanel plan={plan.data?.plan ?? null} className="lg:col-span-7" />
          <WeekPanel home={h} className="lg:col-span-5" />
          <Kpis home={h} onCheckin={() => setCheckin(true)} className="lg:col-span-12" />
          <Panel index="04" label="Voice · 30 days" className="lg:col-span-8" aside={<Legend />}>
            <PracticeChart series={h.series.map((x) => ({ day: x.day, minutes: x.voiced, accuracy: x.pitch }))} goal={Math.max(5, Math.round(h.health.load.cap_min * 0.6))} />
          </Panel>
          <CoachPanel home={h} className="lg:col-span-4" />
          <ProgressPanel home={h} className="lg:col-span-7" />
          <Panel index="07" label="Voice map · 7 days" className="lg:col-span-5" aside={<span className="sc-label">pitch × loudness</span>}>
            {h.map.length === 0 ? (
              <Empty icon={Waves} title="No singing this week yet" className="py-6">
                Every note you sing lands here as a dot: across is pitch, up is loudness. The thickest cloud is where your voice lives.
              </Empty>
            ) : (
              <VoiceMap cells={h.map} comf={h.voice.tested ? [h.voice.comf_low, h.voice.comf_high] : null} passaggio={h.voice.tested ? [h.voice.passaggio.primo, h.voice.passaggio.secondo] : null} />
            )}
          </Panel>
          <Panel index="08" label="Calendar" className="lg:col-span-12" aside={<span className="sc-label">12 weeks · a dash is a day without singing</span>}>
            <div className="flex h-full items-center justify-center overflow-x-auto py-2">
              <HeatDots days={h.heat} goal={h.goal} />
            </div>
          </Panel>
        </div>
      )}
      <CheckInDialog
        open={checkin}
        when="other"
        onClose={() => setCheckin(false)}
        onDone={(_c, advice) => {
          setCheckin(false);
          toast.info(advice);
          home.reload();
          plan.reload();
          app.reload();
        }}
      />
    </div>
  );
}

function Legend(): React.JSX.Element {
  return (
    <span className="sc-label flex items-center gap-3">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-1.5 rounded-[1px] bg-[var(--sc-ink)]" /> voiced min
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full border-[1.5px] border-[var(--sc-voice)]" /> on pitch
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------- health */

function HealthBanner({ home, className }: { home: Home; className?: string }): React.JSX.Element | null {
  const flags = home.health.flags;
  if (flags.length === 0) return null;
  const doctor = flags.find((f) => f.key === 'see_doctor');
  const f = doctor ?? flags[0]!;
  const Icon = doctor !== undefined ? Stethoscope : home.health.rest ? Moon : BedDouble;
  return (
    <div className={cn('flex items-start gap-3 rounded-[var(--sc-radius)] border px-4 py-3', doctor !== undefined ? 'border-[var(--sc-warn)] bg-[var(--sc-warn-soft)]' : 'border-[var(--sc-line)] bg-[var(--sc-panel)]', className)}>
      <Icon size={17} aria-hidden className={cn('mt-0.5 shrink-0', doctor !== undefined ? 'text-[var(--sc-warn)]' : 'text-[var(--sc-ink-2)]')} />
      <div className="min-w-0 flex-1 text-[13px] leading-5">
        <span className="font-semibold">{doctor !== undefined ? 'Please get your voice checked. ' : home.health.rest ? 'A rest day for the voice. ' : home.health.light ? 'A light day. ' : ''}</span>
        {f.text}
        {flags.length > 1 && doctor === undefined && <span className="text-[var(--sc-muted)]"> {flags.slice(1).map((x) => x.text).join(' ')}</span>}
      </div>
      <a href={href('learn', { lesson: 'he-signs' })} className="sc-label shrink-0 hover:text-[var(--sc-ink)]">
        Why
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ plan */

function blockLine(b: PlanBlock): string {
  if (b.kind === 'song') return b.whole === true ? 'The whole song' : b.section !== null && b.section !== undefined && b.section !== '' ? `${b.section} · ${barsText(b.from ?? 1, b.to ?? 1)}` : barsText(b.from ?? 1, b.to ?? 1);
  return KIND_LABEL[b.kind] ?? '';
}

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
      label={plan === null ? 'Plan' : `Plan · ${plan.minutes} min${plan.blocks.some((b) => b.sitting === 2) ? ' · 2 sittings' : ''}`}
      className={cn('min-h-[300px]', className)}
      aside={
        coach ? (
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-[var(--sc-coach-soft)] px-2 text-[11px] font-medium text-[var(--sc-coach)]">
            <Sparkle size={11} aria-hidden /> Proposed by the coach
          </span>
        ) : plan !== null && plan.done > 0 ? (
          <span className="sc-label">
            {plan.done}/{plan.blocks.length} done
          </span>
        ) : (
          <span className="sc-label">Made by the app's rules</span>
        )
      }
      bodyClass="flex flex-col"
    >
      {plan === null ? (
        <div className="flex flex-1 items-center justify-center text-[var(--sc-muted)]">
          <Spinner />
        </div>
      ) : plan.blocks.length === 0 ? (
        <Empty
          icon={Library}
          title="Nothing to plan yet"
          action={
            <Button icon={Library} onClick={() => navigate('library')}>
              Open the library
            </Button>
          }
          className="flex-1"
        />
      ) : (
        <>
          {plan.note !== '' && <p className={cn('mb-2 rounded-[var(--sc-radius-sm)] px-3 py-2 text-[12.5px] leading-[18px]', coach ? 'border-l-2 border-[var(--sc-coach)] bg-[var(--sc-coach-soft)] text-[var(--sc-ink)]' : 'bg-[var(--sc-sunk)] text-[var(--sc-ink-2)]')}>{plan.note}</p>}
          <ol className="flex flex-col">
            {plan.blocks.map((b, i) => {
              const Icon = b.kind === 'song' ? MODE_ICON[b.mode ?? 'sing'] : (KIND_ICON[b.kind] ?? Music2);
              const firstOfSecond = b.sitting === 2 && (i === 0 || plan.blocks[i - 1]?.sitting !== 2);
              return (
                <li key={b.i} className="sc-in" style={{ animationDelay: `${i * 40}ms` }}>
                  {firstOfSecond && <div className="sc-label mb-1 mt-3 border-t border-dashed border-[var(--sc-line-2)] pt-2">Second sitting · an hour or more later</div>}
                  <button type="button" onClick={() => void start(b)} className={cn('sc-focus group flex w-full items-center gap-3 rounded-[var(--sc-radius-sm)] border-b border-[var(--sc-hair)] px-1.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[var(--sc-hover)]', b.done && 'opacity-55')}>
                    <span className="sc-mono w-5 shrink-0 text-[11px] text-[var(--sc-faint)]">{pad2(i + 1)}</span>
                    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full border', b.done ? 'border-[var(--sc-ink)] bg-[var(--sc-ink)] text-[var(--sc-page)]' : 'border-[var(--sc-line-2)] text-[var(--sc-ink-2)]')}>{b.done ? <Check size={13} strokeWidth={2.5} aria-hidden /> : <Icon size={13} strokeWidth={1.9} aria-hidden />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{b.title}</span>
                      <span className="block truncate text-[12px] text-[var(--sc-muted)]">
                        {blockLine(b)}
                        {b.why !== '' ? ` · ${b.why}` : ''}
                      </span>
                    </span>
                    <span className="sc-label hidden shrink-0 sm:inline">{b.kind === 'song' ? b.mode : ''}</span>
                    <span className="sc-mono sc-num w-11 shrink-0 text-right text-[12px] text-[var(--sc-ink-2)]">{b.kind === 'song' && b.tempo !== 100 ? `${b.tempo}%` : ''}</span>
                    <span className="sc-mono sc-num w-12 shrink-0 text-right text-[12px]">{b.minutes} min</span>
                    <ArrowRight size={14} aria-hidden className="shrink-0 text-[var(--sc-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--sc-ink)]" />
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-auto flex items-center gap-2 pt-3">
            {plan.source === 'coach' && (
              <Button variant="ghost" size="sm" onClick={() => void api.resetPlan().catch((err: unknown) => toast.error(errMessage(err)))}>
                Use the app's plan
              </Button>
            )}
            <span className="sc-label">{plan.sung} min of singing</span>
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
      <WeekDial week={home.week} goal={home.goal} today={home.today.minutes} size={220} />
      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <div className="sc-label">Today</div>
          <div className="sc-mono sc-num text-[34px] font-light leading-none tracking-tight">
            <CountUp value={home.today.minutes} />
            <span className="text-[15px] text-[var(--sc-muted)]">/{home.goal} min</span>
          </div>
          <div className="sc-mono sc-num mt-1 text-[11.5px] text-[var(--sc-muted)]">{home.today.voiced} min voiced</div>
        </div>
        <div>
          <div className="sc-label">Streak</div>
          <div className="mt-1 flex items-center gap-1.5 text-[15px] font-semibold">
            <Flame size={16} aria-hidden className={home.streak > 0 ? 'text-[var(--sc-ink)]' : 'text-[var(--sc-faint)]'} />
            <span className="sc-mono sc-num">{home.streak}</span>
            <span className="text-[13px] font-normal text-[var(--sc-muted)]">{home.streak === 1 ? 'day' : 'days'}</span>
          </div>
        </div>
        <div>
          <div className="sc-label">Level</div>
          <div className="mt-1 text-[13.5px] font-medium">
            <span className="sc-mono mr-1.5">{pad2(home.level)}</span>
            {home.level_name || levelName(home.level)}
          </div>
          <div className="sc-mono sc-num mt-0.5 text-[11.5px] text-[var(--sc-muted)]">
            {home.level_met}/{home.level_total} requirements met
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ KPIs */

function Delta({ now, before, lowerBetter }: { now: number | null; before: number | null; lowerBetter?: boolean }): React.JSX.Element | null {
  if (now === null || before === null) return null;
  const d = lowerBetter === true ? Math.round(now - before) : Math.round((now - before) * 100);
  if (d === 0) return null;
  const good = lowerBetter === true ? d < 0 : d > 0;
  return <span className={cn('sc-mono text-[11px]', good ? 'text-[var(--sc-good)]' : 'text-[var(--sc-bad)]')}>{(d > 0 ? '+' : '') + d + (lowerBetter === true ? '¢' : ' pt')}</span>;
}

function Kpis({ home, onCheckin, className }: { home: Home; onCheckin: () => void; className?: string }): React.JSX.Element {
  const t = home.totals;
  const pitch = home.series.map((s) => s.pitch).filter((a): a is number => a !== null);
  const tune = home.series.map((s) => s.in_tune).filter((a): a is number => a !== null);
  const hold = home.series.map((s) => s.hold).filter((a): a is number => a !== null);
  const L = home.health.load;
  const v = home.voice;
  const c = home.health.checkin;
  const worst = c === null ? 0 : Math.max(c.hoarse, c.effort, c.discomfort, c.high_loss, c.clearing);
  const tiles: { label: string; value: React.ReactNode; aside?: React.ReactNode; chart?: React.ReactNode; action?: (() => void) | undefined }[] = [
    {
      label: 'Pitch · 7d',
      value: t.pitch_7 === null ? '—' : (
        <>
          <CountUp value={Math.round(t.pitch_7 * 100)} />%
        </>
      ),
      aside: <Delta now={t.pitch_7} before={t.pitch_prev_7} />,
      chart: <Sparkline values={pitch.slice(-14)} color="var(--sc-voice)" />,
    },
    {
      label: 'In tune · 7d',
      value: t.in_tune_7 === null ? '—' : (
        <>
          <CountUp value={Math.round(t.in_tune_7 * 100)} />%
        </>
      ),
      aside: <Delta now={t.in_tune_7} before={t.in_tune_prev_7} />,
      chart: <Sparkline values={tune.slice(-14)} />,
    },
    { label: 'Hold', value: t.hold_7 === null ? '—' : `${t.hold_7}¢`, aside: <Delta now={t.hold_7} before={t.hold_prev_7} lowerBetter />, chart: <Sparkline values={hold.slice(-14).map((x) => -x)} /> },
    {
      label: 'Range',
      value: v.tested ? <span className="text-[19px]">{noteLabel(v.comf_low) + '–' + noteLabel(v.comf_high)}</span> : '—',
      aside: v.tested ? <span className="sc-mono text-[11px] text-[var(--sc-muted)]">{Math.round(v.comf_high - v.comf_low)} st</span> : undefined,
      action: v.tested ? undefined : () => navigate('settings', { section: 'voice' }),
    },
    {
      label: 'Load',
      value: (
        <>
          <CountUp value={Math.round(L.today_min)} />
          <span className="text-[14px] text-[var(--sc-muted)]">/{L.cap_min}</span>
        </>
      ),
      aside: <span className={cn('sc-mono text-[11px]', L.ratio !== null && L.ratio > 1.3 ? 'text-[var(--sc-warn)]' : 'text-[var(--sc-muted)]')}>{L.ratio === null ? `${L.today_cycles_k}k cycles` : `${L.ratio}× usual`}</span>,
    },
    {
      label: 'Voice check',
      value: c === null ? <span className="text-[15px]">Not today</span> : <span className={cn('text-[17px]', worst >= 4 || c.pain ? 'text-[var(--sc-warn)]' : '')}>{c.pain ? 'Pain' : worst <= 2 ? 'Clear' : worst === 3 ? 'So-so' : 'Tired'}</span>,
      aside: <HeartPulse size={13} aria-hidden className="text-[var(--sc-muted)]" />,
      action: onCheckin,
    },
  ];
  return (
    <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6', className)}>
      {tiles.map((k, i) => {
        const Comp = k.action !== undefined ? 'button' : 'div';
        return (
          <Comp key={k.label} {...(k.action !== undefined ? { type: 'button' as const, onClick: k.action } : {})} className={cn('sc-panel sc-in flex items-end justify-between gap-2 px-3.5 py-3 text-left', k.action !== undefined && 'sc-focus transition-colors hover:bg-[var(--sc-hover)]')} style={{ animationDelay: `${i * 50}ms` }}>
            <div className="min-w-0">
              <div className="sc-label truncate">
                <span className="mr-2 text-[var(--sc-faint)]">03.{i + 1}</span>
                {k.label}
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="sc-mono sc-num text-[24px] font-light leading-none tracking-tight">{k.value}</span>
                {k.aside}
              </div>
            </div>
            {k.chart !== undefined && <span className="hidden shrink-0 2xl:block">{k.chart}</span>}
          </Comp>
        );
      })}
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
    <Panel index="05" label="Coach" className={className} aside={home.unread > 0 ? <span className="sc-label text-[var(--sc-coach)]">{home.unread} new</span> : undefined} bodyClass="flex flex-col gap-3">
      {c !== null ? (
        <a href={href('coach')} className="sc-focus group flex flex-1 gap-2.5 rounded-[var(--sc-radius-sm)] p-1 transition-colors hover:bg-[var(--sc-hover)]">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--sc-coach)] text-[var(--sc-coach-ink)]">
            <Sparkle size={15} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="sc-label block">
              {c.kind === 'review' ? 'Session review' : 'Reply'} · {ago(c.created)}
            </span>
            <span className="mt-1 line-clamp-5 block text-[13px] leading-5 text-[var(--sc-ink-2)]">{c.text}</span>
          </span>
        </a>
      ) : (
        <div className="flex flex-1 items-center gap-2.5 text-[13px] text-[var(--sc-muted)]">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--sc-coach)] text-[var(--sc-coach-ink)]">
            <Sparkle size={15} aria-hidden />
          </span>
          Ask for a song to learn, or anything about your voice.
        </div>
      )}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add “Scarborough Fair” at my level…" aria-label="Message to your coach" />
        <Button type="submit" variant="coach" icon={Send} busy={busy} disabled={text.trim() === ''} aria-label="Send" />
      </form>
    </Panel>
  );
}

/* -------------------------------------------------------------- progress */

const STAGE_FILL: Record<Stage, string> = {
  new: 'var(--sc-line)',
  learning: 'color-mix(in srgb, var(--sc-ink) 35%, var(--sc-line))',
  steady: 'color-mix(in srgb, var(--sc-ink) 70%, var(--sc-line))',
  mastered: 'var(--sc-ink)',
};

export function SectionBars({ song, height = 6 }: { song: Song; height?: number }): React.JSX.Element {
  const total = song.sections.reduce((a, s) => a + (s.to - s.from + 1), 0) || 1;
  return (
    <span className="flex w-full gap-[2px]" style={{ height }}>
      {song.sections.map((s) => (
        <span key={s.i} title={`${s.name} · ${s.stage}${s.best > 0 ? ` · ${s.best}%` : ''}`} className="rounded-[2px] transition-[background-color] duration-500" style={{ flex: s.to - s.from + 1, background: STAGE_FILL[s.stage] }} />
      ))}
      {song.sections.length === 0 && <span className="flex-1 rounded-[2px] bg-[var(--sc-line)]" style={{ flex: total }} />}
    </span>
  );
}

function ProgressPanel({ home, className }: { home: Home; className?: string }): React.JSX.Element {
  const list = home.current.length > 0 ? home.current : home.resume !== null ? [home.resume] : [];
  const comf: [number, number] | null = home.voice.tested ? [home.voice.comf_low, home.voice.comf_high] : null;
  return (
    <Panel
      index="06"
      label="In progress"
      className={className}
      aside={
        <a href={href('library')} className="sc-label hover:text-[var(--sc-ink)]">
          Library
        </a>
      }
    >
      {list.length === 0 ? (
        <Empty
          icon={Library}
          title="No song started yet"
          action={
            <Button icon={Library} onClick={() => navigate('library')}>
              Choose a song
            </Button>
          }
          className="py-6"
        />
      ) : (
        <ul className="flex flex-col">
          {list.map((s, i) => (
            <li key={s.id} className="sc-in" style={{ animationDelay: `${i * 50}ms` }}>
              <a href={href('practice', { song: s.id })} className="sc-focus group flex items-center gap-3 border-b border-[var(--sc-hair)] px-1 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--sc-hover)]">
                <span className="w-[88px] shrink-0 overflow-hidden rounded-[4px] border border-[var(--sc-hair)] bg-[var(--sc-raised)] px-1">
                  <Contour preview={s.preview} height={34} band={comf} shift={s.key_shift} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium">{s.title}</span>
                    <span className="sc-label hidden truncate sm:inline">{s.composer}</span>
                  </span>
                  <span className="mt-1.5 block">
                    <SectionBars song={s} />
                  </span>
                </span>
                <span className="hidden shrink-0 text-right sm:block">
                  <span className="sc-label block">{s.progress.last_at !== '' ? ago(s.progress.last_at) : ''}</span>
                  <span className="sc-mono block text-[11px] text-[var(--sc-muted)]">{fmtMinutes(s.progress.minutes)}</span>
                </span>
                <Ring value={s.progress.pct} size={32}>
                  <span className="sc-mono text-[9px]">{Math.round(s.progress.pct * 100)}</span>
                </Ring>
              </a>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && (
        <div className="mt-2 flex items-center gap-3 px-1">
          {(['learning', 'steady', 'mastered'] as Stage[]).map((st) => (
            <span key={st} className="sc-label flex items-center gap-1.5">
              <StageDots stage={st} size={5} /> {st}
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}
