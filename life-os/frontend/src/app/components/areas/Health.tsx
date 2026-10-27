/**
 * Health: the body today in four drawn gauges (water glasses to tap, sleep
 * by the half hour, steps, a weigh-in with its line), workouts started with
 * one tap on what you did, and the last two weeks as bars.
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { figure, minutes, parseDay, WD1 } from '../../lib/format.ts';
import { act, changed, drop, insert, localDay, patch, tempId, useLive } from '../../lib/live.ts';
import { enter, rowOf, vanish } from '../../lib/motion.ts';
import type { HealthDay, HealthTrend, Workout } from '../../lib/types.ts';
import { AreaArt, HabitArt } from '../art.tsx';
import { ColumnArt, ThingArt, WORKOUT_KINDS, WorkoutArt } from '../art2.tsx';
import { Chip, Meter, Stepper } from '../bits.tsx';
import { Panel } from '../panel.tsx';
import { Bars, LineChart } from '../charts.tsx';
import { logHealth, WaterGlasses } from '../glance.tsx';
import { snack } from '../snack.tsx';
import { Popover, Skeleton } from '../ui.tsx';

const READS = ['health_logs', 'workouts', 'settings', 'goals'] as const;

function Gauge({ art, title, value, sub, children, className }: { art: ReactNode; title: string; value: ReactNode; sub?: ReactNode | undefined; children?: ReactNode | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex min-w-0 flex-col rounded-[var(--lo-r-lg)] bg-[var(--lo-sunk)] p-4', className)}>
      <div className="flex items-center gap-3">
        {art}
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-[var(--lo-muted)]">{title}</p>
          <p className="num text-[26px] font-extrabold leading-8">{value}</p>
          {sub !== undefined && <p className="text-[12px] font-semibold text-[var(--lo-ink-2)]">{sub}</p>}
        </div>
      </div>
      {children !== undefined && <div className="mt-3">{children}</div>}
    </div>
  );
}

function WorkoutButton({ kind, label }: { kind: string; label: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const add = async (m: number): Promise<void> => {
    setOpen(false);
    snack(`${label}, ${minutes(m)}. Nice`);
    const draft = { id: tempId(), kind, minutes: m, date: localDay(), note: '', actor: 'person' } as unknown as Workout;
    await act([insert((k, o) => k === 'workouts' && typeof o.log === 'object', draft)], () => op('workouts.add', { kind, minutes: m }), ['workouts', 'health_logs', 'goals', 'habits']);
  };
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen(!open)} className="flex w-[84px] flex-col items-center gap-1 rounded-[var(--lo-r-lg)] py-2 transition-transform hover:-translate-y-0.5 hover:bg-[var(--lo-sunk)]">
        <WorkoutArt kind={kind} size={48} />
        <span className="text-[13px] font-bold">{label}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} className="p-2">
        <p className="px-1 pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">How long?</p>
        <div className="flex gap-1">
          {[15, 30, 45, 60, 90].map((m) => (
            <button key={m} type="button" onClick={() => void add(m)} className="h-9 rounded-[var(--lo-r-sm)] bg-[var(--lo-sunk)] px-3 text-[13px] font-extrabold hover:bg-[var(--lo-sunk-hover)]">
              {m < 60 ? `${m} min` : `${m / 60} h`.replace('1.5 h', '1 h 30')}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

type Metric = 'water' | 'sleep_h' | 'steps' | 'workout_min';

export default function HealthTool(): React.JSX.Element {
  const day = useLive<HealthDay>((signal) => op('health.day', {}, { quiet: true, signal }), [...READS], []);
  const trend = useLive<HealthTrend>((signal) => op('health.trend', { days: 30 }, { quiet: true, signal }), [...READS], []);
  const [metric, setMetric] = useState<Metric>('water');
  const [steps, setSteps] = useState('');
  const [weight, setWeight] = useState('');
  const d = day.data;
  const t = trend.data;
  if (d === null) return <Skeleton className="h-48 w-full" />;
  const unitW = d.units === 'imperial' ? 'lb' : 'kg';
  const last14 = (t?.days ?? []).slice(-14);
  const weights = (t?.days ?? []).filter((x) => x.weight > 0).map((x) => ({ date: x.date, value: x.weight }));
  const metricGoal: Record<Metric, number | undefined> = { water: d.goals.water, sleep_h: d.goals.sleep_h, steps: d.goals.steps, workout_min: undefined };
  return (
    <>
      <Panel title="Your body today" art={<AreaArt kind="health" size={26} />}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Gauge art={<HabitArt art="water" size={52} />} title="Water" value={`${d.log.water}`} sub={`of ${d.goals.water} glasses`}>
          <WaterGlasses log={d.log} goal={d.goals.water} size={26} />
        </Gauge>
        <Gauge art={<HabitArt art="sleep" size={52} />} title="Last night" value={d.log.sleep_h > 0 ? `${figure(d.log.sleep_h)} h` : 'Not noted'} sub={`Aim: ${d.goals.sleep_h} h`}>
          <Stepper label="hours of sleep" value={d.log.sleep_h > 0 ? d.log.sleep_h : d.goals.sleep_h} step={0.5} min={0} max={16} onChange={(v) => void logHealth({ sleep_h: v })} format={(v) => `${figure(v)} h`} />
        </Gauge>
        <Gauge art={<HabitArt art="walk" size={52} />} title="Steps" value={d.log.steps > 0 ? d.log.steps.toLocaleString() : '0'} sub={`of ${d.goals.steps.toLocaleString()}`}>
          <Meter value={d.goals.steps > 0 ? d.log.steps / d.goals.steps : 0} color="var(--lo-k-health)" label="Steps of the goal" />
          <div className="mt-2 flex gap-1.5">
            <input
              value={steps}
              onChange={(e) => setSteps(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && steps !== '') void logHealth({ steps: Number(steps) }).then(() => setSteps(''));
              }}
              inputMode="numeric"
              placeholder="Steps so far"
              aria-label="Steps so far"
              className="num h-8 min-w-0 flex-1 rounded-[var(--lo-r-sm)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-2 text-[13px] font-bold outline-none focus:border-[var(--lo-accent)]"
            />
            <button type="button" onClick={() => void logHealth({ steps: d.log.steps + 1000 })} className="h-8 rounded-[var(--lo-r-sm)] bg-[var(--lo-sunk)] px-2 text-[12px] font-extrabold hover:bg-[var(--lo-sunk-hover)]">
              +1,000
            </button>
          </div>
        </Gauge>
        <Gauge art={<ThingArt kind="scale" size={52} />} title="Weight" value={d.last_weight !== null ? `${figure(d.last_weight.weight)} ${unitW}` : 'No weigh-in'} sub={d.last_weight !== null && d.last_weight.date !== d.log.date ? `Last on ${d.last_weight.date}` : d.last_weight !== null ? 'Today' : undefined}>
          <div className="flex gap-1.5">
            <input
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              onKeyDown={(e) => {
                const n = Number(weight.replace(',', '.'));
                if (e.key === 'Enter' && weight !== '' && !Number.isNaN(n)) void logHealth({ weight: n }).then(() => setWeight(''));
              }}
              inputMode="decimal"
              placeholder={`Today, in ${unitW}`}
              aria-label="Weigh in"
              className="num h-8 min-w-0 flex-1 rounded-[var(--lo-r-sm)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-2 text-[13px] font-bold outline-none focus:border-[var(--lo-accent)]"
            />
          </div>
          {weights.length > 1 && (
            <div className="mt-2">
              <LineChart points={weights} height={56} label="Weight over the last month" color="var(--lo-k-health)" soft="var(--lo-k-health-soft)" format={(v) => `${figure(v)} ${unitW}`} />
            </div>
          )}
        </Gauge>
      </div>
      </Panel>

      <Panel title="Moved today?" art={<WorkoutArt kind="run" size={26} />} note={d.workouts.length > 0 ? `${d.workouts.length} today` : undefined}>
        <div className="flex flex-wrap gap-1">
          {WORKOUT_KINDS.map((w) => (
            <WorkoutButton key={w.key} kind={w.key} label={w.label} />
          ))}
        </div>
        {d.workouts.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {d.workouts.map((w) => (
              <li key={w.id} data-row className={cn('flex h-10 items-center gap-2 rounded-[var(--lo-r)] bg-[var(--lo-k-health-soft)] pl-1.5 pr-1 text-[13px] font-bold text-[var(--lo-k-health-text)]', enter(w.id))}>
                <WorkoutArt kind={w.kind} size={28} />
                {WORKOUT_KINDS.find((k) => k.key === w.kind)?.label} · {minutes(w.minutes)}
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={(e) => {
                    void vanish(rowOf(e), [drop(w.id)], () => op('workouts.delete', { workout: w.id }), ['workouts', 'goals', 'health_logs'], 'shrink').then((r) => r !== undefined && snack('Workout removed'));
                  }}
                  className="flex size-7 items-center justify-center rounded-[var(--lo-r-sm)] hover:bg-[var(--lo-card)]"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {t !== null && (
        <Panel
          title="The last two weeks"
          art={<ColumnArt kind="coming" size={24} />}
          action={
            <div className="flex gap-1">
              {(
                [
                  ['water', 'Water'],
                  ['sleep_h', 'Sleep'],
                  ['steps', 'Steps'],
                  ['workout_min', 'Workouts'],
                ] as [Metric, string][]
              ).map(([k, l]) => (
                <Chip key={k} active={metric === k} onClick={() => setMetric(k)} className="h-7 px-2 text-[12px]">
                  {l}
                </Chip>
              ))}
            </div>
          }
        >
          <div>
            <Bars values={last14.map((x) => x[metric])} labels={last14.map((x) => x.date)} goal={metricGoal[metric]} color="var(--lo-k-health)" height={96} format={(v) => (metric === 'workout_min' ? minutes(v) || '0' : metric === 'sleep_h' ? `${figure(v)} h` : v.toLocaleString())} />
            <div className="mt-1 flex gap-[3px]">
              {last14.map((x) => (
                <span key={x.date} className="min-w-0 flex-1 text-center text-[12px] font-bold text-[var(--lo-muted)]">
                  {WD1[parseDay(x.date).getDay()]}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[12px] font-semibold text-[var(--lo-ink-2)]">
              {t.averages.sleep_h !== null ? `Sleep ${figure(t.averages.sleep_h)} h on average` : 'No sleep noted yet'}
              {t.averages.water !== null ? ` · ${figure(t.averages.water)} glasses a day` : ''}
              {` · ${t.workouts} workout${t.workouts === 1 ? '' : 's'} this month`}
            </p>
          </div>
        </Panel>
      )}
    </>
  );
}
