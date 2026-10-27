/**
 * The first run: five short steps that set up everything at once (your
 * name and week, the parts of your life, an optional first goal and first
 * habit, the daily and weekly rhythm), sent in one onboarding.complete call.
 * Every step can be skipped and all of it changed later. Where you live (for
 * the weather and the currency) is found by itself.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CloudSun, Mountain, Sparkles, Sprout, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed } from '../lib/live.ts';
import { navigate } from '../lib/router.ts';
import { useStatus } from '../lib/context.tsx';
import type { Place } from '../lib/types.ts';
import { AREA_KINDS, AREA_NAMES, AreaArt, HABIT_ARTS, HabitArt } from '../components/art.tsx';
import type { AreaKind } from '../components/art.tsx';
import { useSky } from '../components/page.tsx';
import { Scene } from '../components/Scene.tsx';
import { Button, Field, Popover, Segmented, Toggle, inputCls } from '../components/ui.tsx';
import { DateButton, todayLocal } from '../components/pickers.tsx';

const STEPS = ['You', 'Areas', 'A goal', 'A habit', 'Rhythm'] as const;

const EURO = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];
const BY_COUNTRY: Record<string, string> = { US: 'USD', GB: 'GBP', JP: 'JPY', CN: 'CNY', KR: 'KRW', IN: 'INR', AU: 'AUD', CA: 'CAD', NZ: 'NZD', SG: 'SGD', MY: 'MYR', HK: 'HKD', TW: 'TWD', TH: 'THB', ID: 'IDR', PH: 'PHP', VN: 'VND', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', ZA: 'ZAR', NG: 'NGN', KE: 'KES', AE: 'AED', SA: 'SAR', IL: 'ILS', TR: 'TRY', UA: 'UAH', EG: 'EGP', PK: 'PKR', BD: 'BDT', IS: 'ISK' };

function Chip({ on, onClick, kind, children, title }: { on: boolean; onClick: () => void; kind: AreaKind; children: React.ReactNode; title?: string | undefined }): React.JSX.Element {
  return (
    <button type="button" aria-pressed={on} title={title} onClick={onClick} className={cn('inline-flex h-10 items-center gap-2 rounded-full border pl-1 pr-4 text-[14px] font-bold transition-colors', on ? 'border-transparent bg-[var(--lo-moss-soft)] text-[var(--lo-moss-text)]' : 'border-[var(--lo-line)] bg-[var(--lo-card)] text-[var(--lo-ink-2)] hover:bg-[var(--lo-sunk)]')}>
      <span className={cn('flex size-8 items-center justify-center rounded-full', on ? 'bg-[var(--lo-card)]' : 'bg-[var(--lo-sunk)]')}>{on ? <Check size={14} strokeWidth={3} /> : <AreaArt kind={kind} size={24} />}</span>
      {children}
    </button>
  );
}

/** The habit's drawing: a button that opens the set of drawings. */
function ArtPicker({ value, onChange }: { value: string; onChange: (art: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={ref} type="button" aria-label="Choose a drawing" title="Choose a drawing" onClick={() => setOpen(!open)} className="flex size-12 shrink-0 items-center justify-center rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] hover:bg-[var(--lo-sunk)]">
        <HabitArt art={value} size={34} />
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
                onChange(a.key);
                setOpen(false);
              }}
              className={cn('flex size-11 items-center justify-center rounded-[var(--lo-r-sm)] border-2', value === a.key ? 'border-[var(--lo-moss)] bg-[var(--lo-moss-soft)]' : 'border-transparent hover:bg-[var(--lo-sunk)]')}
            >
              <HabitArt art={a.key} size={30} />
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

export default function WelcomePage(): React.JSX.Element {
  const status = useStatus().data;
  const sky = useSky();
  const today = status?.today ?? todayLocal();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(status?.owner_name ?? '');
  const [weekStart, setWeekStart] = useState<'monday' | 'sunday'>(status?.week_starts_on === 0 ? 'sunday' : 'monday');
  const [areas, setAreas] = useState<AreaKind[]>([]);
  const [goal, setGoal] = useState({ title: '', area: '' as AreaKind | '', measure: 'none' as 'none' | 'number_up', target: '', unit: '', deadline: '', purpose: '' });
  const [habit, setHabit] = useState({ name: '', art: 'sprout', area: '' as AreaKind | '', schedule_kind: 'daily' as 'daily' | 'weekdays', cue: '', time_of_day: 'morning' as 'morning' | 'afternoon' | 'evening' | 'anytime', for_goal: false });
  const [routines, setRoutines] = useState({ morning_note: true, evening_checkin: true, weekly_recap: true });
  const [where, setWhere] = useState<{ currency: string; units: 'metric' | 'imperial' } | null>(null);
  const [busy, setBusy] = useState(false);

  // Where they are sets the currency and units (both can be changed in Settings).
  useEffect(() => {
    void op<{ place: Place | null }>('world.place', {}, { quiet: true })
      .then((r) => {
        if (r.place === null) return;
        const c = r.place.country;
        setWhere({ currency: EURO.includes(c) ? 'EUR' : (BY_COUNTRY[c] ?? 'USD'), units: ['US', 'LR', 'MM'].includes(c) ? 'imperial' : 'metric' });
      })
      .catch(() => undefined);
  }, []);

  const toggleArea = (k: AreaKind): void => setAreas((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));

  const finish = async (): Promise<void> => {
    setBusy(true);
    try {
      const chosen = areas.length > 0 ? areas : AREA_KINDS;
      const params: Record<string, unknown> = {
        owner_name: name.trim(),
        week_starts_on: weekStart,
        areas: chosen,
        routines,
      };
      if (where !== null) {
        params['currency'] = where.currency;
        params['units'] = where.units;
      }
      if (goal.title.trim() !== '') {
        const g: Record<string, unknown> = { title: goal.title.trim(), area: goal.area !== '' ? goal.area : chosen[0], measure: goal.measure };
        if (goal.measure === 'number_up' && goal.target !== '') {
          g['target'] = goal.target;
          g['baseline'] = '0';
          if (goal.unit.trim() !== '') g['unit'] = goal.unit.trim();
        }
        if (goal.deadline !== '') g['deadline'] = goal.deadline;
        if (goal.purpose.trim() !== '') g['purpose'] = goal.purpose.trim();
        params['goal'] = g;
      }
      if (habit.name.trim() !== '') {
        const h: Record<string, unknown> = { name: habit.name.trim(), art: habit.art, schedule: habit.schedule_kind, time_of_day: habit.time_of_day };
        if (habit.area !== '') h['area'] = habit.area;
        if (habit.cue.trim() !== '') h['cue'] = habit.cue.trim();
        if (habit.for_goal) h['for_goal'] = true;
        if (habit.schedule_kind === 'weekdays') h['days'] = [1, 2, 3, 4, 5];
        params['habits'] = [h];
      }
      await op('onboarding.complete', params);
      changed('settings', 'areas', 'goals', 'habits', 'routines');
      toast.success(name.trim() !== '' ? `Welcome, ${name.trim()}` : 'Welcome');
      navigate('home');
    } finally {
      setBusy(false);
    }
  };

  const areaOptions = areas.map((k) => ({ value: k, label: AREA_NAMES[k] }));
  const last = step === STEPS.length - 1;
  const INTRO: [LucideIcon, string][] = [
    [CloudSun, 'Your weather, your news and your day on one page'],
    [Mountain, 'Goals count by themselves, so progress and pace show'],
    [Sprout, 'Habits count consistency, not perfect streaks'],
    [Sun, 'Each day: a short list and your top three'],
    [Sparkles, 'Your AI agent plans and proposes; you decide'],
  ];

  return (
    <div className="min-h-full pb-16">
      <Scene height={310} seed="welcome" part={sky.part} season={sky.season} variant="home">
        <div className="mx-auto flex max-w-[760px] flex-col items-center px-5 pt-8 text-center">
          {/* A wooden sign on the hill, like the one in the sidebar. */}
          <div className="rounded-[var(--lo-r-lg)] border-2 border-[var(--lo-plaque-edge)] bg-[var(--lo-plaque)] px-6 py-3 text-[var(--lo-on-plaque)] shadow-[inset_0_-3px_0_rgb(0_0_0/0.12),var(--lo-shadow)]">
            <p className="text-[12px] font-bold opacity-85">Life OS</p>
            <h1 className="serif text-[26px] font-semibold leading-9">{step === 0 ? 'Welcome. One calm place for your whole life.' : STEPS[step]}</h1>
          </div>
        </div>
      </Scene>
      <div className="mx-auto -mt-16 w-full max-w-[760px] px-4">
        <div className="lo-card relative p-6 md:p-8">
          <ol aria-label="Steps" className="mb-6 flex items-center justify-center gap-1.5">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button type="button" onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined} title={s} className={cn('block h-2 rounded-full transition-all', i === step ? 'w-8 bg-[var(--lo-primary)]' : i < step ? 'w-2 bg-[var(--lo-moss)]' : 'w-2 bg-[var(--lo-track)]')}>
                  <span className="sr-only">{s}</span>
                </button>
              </li>
            ))}
          </ol>

          {step === 0 && (
            <div className="mx-auto flex max-w-md flex-col gap-5">
              <Field label="What should we call you?">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setStep(1)} placeholder="Your first name" className={cn(inputCls, 'h-11 text-[15px]')} />
              </Field>
              <Field label="Your week starts on">
                <Segmented
                  label="Your week starts on"
                  value={weekStart}
                  onChange={setWeekStart}
                  options={[
                    { value: 'monday', label: 'Monday' },
                    { value: 'sunday', label: 'Sunday' },
                  ]}
                />
              </Field>
              <ul className="flex flex-col gap-2 text-[14px] text-[var(--lo-ink-2)]">
                {INTRO.map(([Icon, t]) => (
                  <li key={t} className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--lo-moss-soft)] text-[var(--lo-moss-text)]">
                      <Icon size={15} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <p className="text-center text-[14px] text-[var(--lo-ink-2)]">The ongoing parts of your life.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {AREA_KINDS.map((k) => (
                  <Chip key={k} on={areas.includes(k)} onClick={() => toggleArea(k)} kind={k}>
                    {AREA_NAMES[k]}
                  </Chip>
                ))}
              </div>
              <p className="text-center text-[13px] font-bold text-[var(--lo-muted)]">{areas.length === 0 ? 'None chosen: all of them stay on' : `${areas.length} chosen`}</p>
            </div>
          )}

          {step === 2 && (
            <div className="mx-auto flex max-w-md flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--lo-moss-soft)] text-[var(--lo-moss-text)]">
                  <Mountain size={18} />
                </span>
                <p className="text-[14px] text-[var(--lo-ink-2)]">One thing you want to be true by a date.</p>
              </div>
              <input autoFocus value={goal.title} onChange={(e) => setGoal({ ...goal, title: e.target.value })} placeholder="Run a half marathon" aria-label="Goal" className="serif h-12 w-full rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-4 text-[15px] font-semibold outline-none focus:border-[var(--lo-accent)]" />
              {goal.title.trim() !== '' && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={goal.area} onChange={(e) => setGoal({ ...goal, area: e.target.value as AreaKind | '' })} aria-label="Area" className={cn(inputCls, 'h-8 w-auto rounded-full pr-8 text-[13px] font-bold')}>
                      <option value="">{areaOptions.length > 0 ? 'Which area' : AREA_NAMES[AREA_KINDS[0] as AreaKind]}</option>
                      {(areaOptions.length > 0 ? areaOptions : AREA_KINDS.map((k) => ({ value: k, label: AREA_NAMES[k] }))).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <DateButton value={goal.deadline} today={today} onChange={(d) => setGoal({ ...goal, deadline: d })} placeholder="By when" />
                  </div>
                  <Segmented
                    size="sm"
                    label="Measured by"
                    value={goal.measure}
                    onChange={(v) => setGoal({ ...goal, measure: v })}
                    options={[
                      { value: 'none', label: 'Done or not' },
                      { value: 'number_up', label: 'A number' },
                    ]}
                  />
                  {goal.measure === 'number_up' && (
                    <div className="flex items-center gap-2">
                      <input value={goal.target} onChange={(e) => setGoal({ ...goal, target: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="21" aria-label="Target" inputMode="decimal" className={cn(inputCls, 'num w-24')} />
                      <input value={goal.unit} onChange={(e) => setGoal({ ...goal, unit: e.target.value })} placeholder="km" aria-label="Unit" className={cn(inputCls, 'w-32')} />
                    </div>
                  )}
                  <Field label="Why it matters">
                    <input value={goal.purpose} onChange={(e) => setGoal({ ...goal, purpose: e.target.value })} placeholder="To feel strong at forty" className={inputCls} />
                  </Field>
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="mx-auto flex max-w-md flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--lo-moss-soft)] text-[var(--lo-moss-text)]">
                  <Sprout size={18} />
                </span>
                <p className="text-[14px] text-[var(--lo-ink-2)]">Start small enough that it cannot fail.</p>
              </div>
              <div className="flex items-center gap-2">
                <ArtPicker value={habit.art} onChange={(a) => setHabit({ ...habit, art: a })} />
                <input value={habit.name} onChange={(e) => setHabit({ ...habit, name: e.target.value })} placeholder="Walk ten minutes" aria-label="Habit" className="serif h-12 min-w-0 flex-1 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-4 text-[15px] font-semibold outline-none focus:border-[var(--lo-accent)]" />
              </div>
              {habit.name.trim() !== '' && (
                <>
                  <Field label="The cue">
                    <input value={habit.cue} onChange={(e) => setHabit({ ...habit, cue: e.target.value })} placeholder="After my morning coffee" className={inputCls} />
                  </Field>
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented
                      size="sm"
                      label="How often"
                      value={habit.schedule_kind}
                      onChange={(v) => setHabit({ ...habit, schedule_kind: v })}
                      options={[
                        { value: 'daily', label: 'Every day' },
                        { value: 'weekdays', label: 'Weekdays' },
                      ]}
                    />
                    <Segmented
                      size="sm"
                      label="When"
                      value={habit.time_of_day}
                      onChange={(v) => setHabit({ ...habit, time_of_day: v })}
                      options={[
                        { value: 'morning', label: 'Morning' },
                        { value: 'afternoon', label: 'Afternoon' },
                        { value: 'evening', label: 'Evening' },
                        { value: 'anytime', label: 'Any time' },
                      ]}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {areaOptions.length > 0 && (
                      <select value={habit.area} onChange={(e) => setHabit({ ...habit, area: e.target.value as AreaKind | '' })} aria-label="Area" className={cn(inputCls, 'h-8 w-auto rounded-full pr-8 text-[13px] font-bold')}>
                        <option value="">No area</option>
                        {areaOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {goal.title.trim() !== '' && (
                      <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-bold">
                        <Toggle checked={habit.for_goal} onChange={(v) => setHabit({ ...habit, for_goal: v })} label="Counts toward the goal" />
                        Counts toward "{goal.title.trim()}"
                      </label>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="mx-auto flex max-w-md flex-col gap-3">
              <p className="mb-1 text-center text-[14px] text-[var(--lo-ink-2)]">A light rhythm keeps it alive.</p>
              {(
                [
                  ['morning_note', 'Morning note', 'Your AI agent writes a few lines about the day ahead'],
                  ['evening_checkin', 'Evening check-in', 'Close the day and move what is left'],
                  ['weekly_recap', 'Weekly recap', 'The week in numbers, with a few words from your AI agent'],
                ] as const
              ).map(([k, t, d]) => (
                <div key={k} className="lo-sunk flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-[14px] font-bold">{t}</span>
                    <span className="block text-[12px] font-semibold text-[var(--lo-muted)]">{d}</span>
                  </span>
                  <Toggle checked={routines[k]} onChange={(v) => setRoutines({ ...routines, [k]: v })} label={t} />
                </div>
              ))}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            {step > 0 ? (
              <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(step - 1)}>
                Back
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => void finish()} disabled={busy}>
                Skip setup
              </Button>
            )}
            {last ? (
              <Button variant="primary" size="lg" icon={Check} loading={busy} onClick={() => void finish()}>
                Start my Life OS
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={() => setStep(step + 1)}>
                {(step === 2 && goal.title.trim() === '') || (step === 3 && habit.name.trim() === '') ? 'Skip' : 'Next'} <ArrowRight size={16} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
