/**
 * Goals live inside their area of life. Most measure themselves: a savings
 * goal fills from its jar, a reading goal from books finished, a weight goal
 * from weigh-ins, a habits goal from how often its habits are done. A goal is
 * drawn as a trail to a flag, the area's drawing walking along it.
 *
 * - GoalTrail: the trail (on lists)
 * - NewGoal: start a goal from an idea for the area, or your own words
 * - GoalDrawer: one goal, with the one action its measure needs
 */
import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Pause, Play, Plus, Trash2, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useStatus } from '../lib/context.tsx';
import { addDays, figure, money, relDay } from '../lib/format.ts';
import { act, changed, drop, patch, useLive } from '../lib/live.ts';
import type { Goal, GoalDetail, Measure } from '../lib/types.ts';
import { AgentButton } from './agent.tsx';
import { AREA_NAMES, AreaArt, HabitArt, Jar } from './art.tsx';
import type { AreaKind } from './art.tsx';
import { ThingArt } from './art2.tsx';
import { AddLine, AreaChoice, CheckButton, Chip, InlineText, kindColor } from './bits.tsx';
import { HabitIdeas, HabitTile } from './habits.tsx';
import { DateButton } from './pickers.tsx';
import { snack } from './snack.tsx';
import { QuickAdd, TaskRow } from './tasks.tsx';
import { Button, Drawer, Modal, Skeleton, useConfirm } from './ui.tsx';

export function goalsChanged(): void {
  changed('goals', 'goal_checkins', 'money_pots', 'tasks', 'habits', 'projects', 'books', 'health_logs');
}

/* ------------------------------------------------------------- numbers */

export function useMoney(): (minor: number, opts?: { whole?: boolean | undefined; sign?: boolean | undefined }) => string {
  const s = useStatus().data;
  return (minor, opts) => money(minor, s?.currency ?? 'USD', s?.digits ?? 2, opts);
}

/** "EUR 500 of 2,000", "1 of 12 books", "71.2 kg (aim 70)". */
export function goalNumbers(g: Goal, fmt: (minor: number) => string): string {
  switch (g.measure) {
    case 'pot':
      return g.pot !== null ? `${fmt(g.pot.saved)} of ${fmt(g.pot.target)}` : '';
    case 'books':
      return `${figure(g.current)} of ${figure(g.target)} books`;
    case 'weight':
      return `${figure(g.current)}${g.unit !== '' ? ' ' + g.unit : ''} now, aiming for ${figure(g.target)}`;
    case 'number_up':
    case 'number_down':
      return `${figure(g.current)} of ${figure(g.target)}${g.unit !== '' ? ' ' + g.unit : ''}`;
    case 'milestones': {
      const done = g.milestones.filter((m) => m.done).length;
      return `${done} of ${g.milestones.length} milestones`;
    }
    case 'habits':
      return `${Math.round(g.progress * 100)}% of days`;
    case 'tasks':
      return `${Math.round(g.progress * 100)}% of its tasks`;
    default:
      return g.state === 'done' ? 'Done' : '';
  }
}

const PACE_WORDS: Record<string, string> = { ahead: 'Ahead', on_track: 'On track', behind: 'Behind', done: 'Done' };

/* ---------------------------------------------------------------- trail */

/**
 * The trail: a winding path from a start stone to a flag; the area's drawing
 * stands where the goal is now, and a small mark shows where it would be on
 * pace today.
 */
export function Trail({ progress, pace, kind, height = 44 }: { progress: number; pace: number | null; kind: AreaKind; height?: number | undefined }): React.JSX.Element {
  const p = Math.max(0, Math.min(1, progress));
  const W = 300;
  const H = height;
  const y = (x: number): number => H * 0.62 + Math.sin((x / W) * Math.PI * 2.2) * (H * 0.14);
  let d = `M 8 ${y(8).toFixed(1)}`;
  for (let x = 16; x <= W - 18; x += 8) d += ` L ${x} ${y(x).toFixed(1)}`;
  const px = 8 + (W - 26) * p;
  const pacex = pace !== null && pace > 0 && pace < 1 ? 8 + (W - 26) * pace : null;
  let done = `M 8 ${y(8).toFixed(1)}`;
  for (let x = 16; x <= px; x += 8) done += ` L ${x} ${y(x).toFixed(1)}`;
  done += ` L ${px.toFixed(1)} ${y(px).toFixed(1)}`;
  return (
    <div className="relative w-full" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        <path d={d} fill="none" stroke="var(--lo-track)" strokeWidth={5} strokeLinecap="round" strokeDasharray="1 9" vectorEffect="non-scaling-stroke" />
        <path d={done} fill="none" stroke={kindColor(kind)} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {pacex !== null && <line x1={pacex} x2={pacex} y1={y(pacex) - 9} y2={y(pacex) + 9} stroke="var(--lo-ink-2)" strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="absolute" style={{ right: -2, top: -6 }}>
        <ThingArt kind="flag" size={Math.round(H * 0.8)} />
      </span>
      <span className="absolute -translate-x-1/2 transition-[left] duration-700" style={{ left: `calc(${(px / W) * 100}% )`, top: -2 }}>
        <AreaArt kind={kind} size={Math.round(H * 0.72)} />
      </span>
    </div>
  );
}

/** A goal on a list: the title, where it stands in words, the trail. */
export function GoalTrail({ goal, onOpen, compact = false }: { goal: Goal; onOpen: () => void; compact?: boolean | undefined }): React.JSX.Element {
  const fmt = useMoney();
  const today = useStatus().data?.today ?? '';
  const nums = goalNumbers(goal, (m) => fmt(m, { whole: true }));
  return (
    <button type="button" onClick={onOpen} className="group block w-full rounded-[var(--lo-r)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--lo-sunk)]">
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{goal.title}</span>
        <span className="num shrink-0 text-[13px] font-extrabold" style={{ color: kindColor(goal.area, 'text') }}>
          {Math.round(goal.progress * 100)}%
        </span>
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] font-semibold text-[var(--lo-muted)]">
        {nums !== '' && <span className="text-[var(--lo-ink-2)]">{nums}</span>}
        {goal.pace_state !== 'none' && PACE_WORDS[goal.pace_state] !== undefined && <span className={cn(goal.pace_state === 'behind' && 'text-[var(--lo-amber-text)]', goal.pace_state === 'ahead' && 'text-[var(--lo-green-text)]')}>{PACE_WORDS[goal.pace_state]}</span>}
        {goal.deadline !== '' && goal.state === 'active' && <span>by {relDay(goal.deadline, today)}</span>}
        {goal.state === 'paused' && <span>Paused</span>}
      </span>
      {!compact && (
        <span className="mt-1.5 block pr-6">
          <Trail progress={goal.progress} pace={goal.pace} kind={goal.area} />
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------ the drawer */

interface PanelApi {
  open: (id: string) => void;
  create: (area?: AreaKind | undefined) => void;
}

const Ctx = createContext<PanelApi>({ open: () => undefined, create: () => undefined });

export function useGoalPanel(): PanelApi {
  return useContext(Ctx);
}

export function GoalPanelProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [id, setId] = useState<string | null>(null);
  const [creating, setCreating] = useState<AreaKind | '' | null>(null);
  const open = useCallback((g: string) => setId(g), []);
  const create = useCallback((a?: AreaKind | undefined) => setCreating(a ?? ''), []);
  return (
    <Ctx.Provider value={{ open, create }}>
      {children}
      {id !== null && <GoalDrawer id={id} onClose={() => setId(null)} />}
      {creating !== null && (
        <NewGoal
          area={creating}
          onClose={() => setCreating(null)}
          onMade={(g) => {
            setCreating(null);
            setId(g.id);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

/* -------------------------------------------------------------- new goal */

interface GoalIdea {
  title: string;
  measure: Measure;
  target?: string | undefined;
  unit?: string | undefined;
  milestones?: string[] | undefined;
  months?: number | undefined;
}

const IDEAS: Record<AreaKind, GoalIdea[]> = {
  health: [
    { title: 'Reach a healthy weight', measure: 'weight', unit: 'kg', months: 6 },
    { title: 'Run 5 km without stopping', measure: 'number_up', target: '5', unit: 'km', months: 3 },
    { title: 'Move every day', measure: 'habits', months: 3 },
  ],
  money: [
    { title: 'Save for a holiday', measure: 'pot', target: '1500', months: 6 },
    { title: 'Build a rainy day fund', measure: 'pot', target: '3000', months: 12 },
    { title: 'Pay off the card', measure: 'number_down', unit: 'owed', months: 6 },
  ],
  relationships: [
    { title: 'A family trip this year', measure: 'milestones', milestones: ['Choose where', 'Save for it', 'Book it', 'Go'] },
    { title: 'Call home every week', measure: 'habits', months: 3 },
    { title: 'See my friends more', measure: 'habits', months: 3 },
    { title: 'Plan a weekend away together', measure: 'milestones', milestones: ['Pick a place', 'Book somewhere to stay', 'Go'] },
  ],
  work: [
    { title: 'Finish a big project', measure: 'tasks', months: 3 },
    { title: 'Get a promotion', measure: 'milestones', milestones: ['Ask what it takes', 'Lead something visible', 'Have the talk'], months: 9 },
  ],
  home: [
    { title: 'Declutter the house', measure: 'tasks', months: 2 },
    { title: 'Make the garden nice', measure: 'milestones', milestones: ['Clear it', 'Plant', 'Sit in it'] },
  ],
  growth: [
    { title: 'Read 12 books this year', measure: 'books', target: '12' },
    { title: 'Learn a new language', measure: 'milestones', milestones: ['Learn the basics', 'Hold a short talk', 'Read a simple book'], months: 12 },
  ],
  fun: [
    { title: 'Visit a new country', measure: 'milestones', milestones: ['Pick it', 'Save for it', 'Book it', 'Go'], months: 12 },
    { title: 'Learn something just for fun', measure: 'habits', months: 3 },
  ],
  mind: [
    { title: 'Feel calmer', measure: 'habits', months: 2 },
    { title: 'Sleep better', measure: 'habits', months: 2 },
  ],
};

const MEASURE_CHOICES: { value: Measure; label: string; hint: string }[] = [
  { value: 'pot', label: 'Saving money', hint: 'Fills from its own jar' },
  { value: 'number_up', label: 'A number going up', hint: 'You note where you are' },
  { value: 'number_down', label: 'A number going down', hint: 'Like a debt' },
  { value: 'weight', label: 'My weight', hint: 'From your weigh-ins' },
  { value: 'books', label: 'Books read', hint: 'From books you finish' },
  { value: 'milestones', label: 'Milestones', hint: 'A few big steps' },
  { value: 'habits', label: 'Habits', hint: 'How often you do them' },
  { value: 'tasks', label: 'Tasks', hint: 'Its cards on the board' },
  { value: 'none', label: 'Just done or not', hint: 'Tick it when it is done' },
];

function monthsAhead(today: string, n: number): string {
  return addDays(today, Math.round(n * 30.4));
}

function NewGoal({ area, onClose, onMade }: { area: AreaKind | ''; onClose: () => void; onMade: (g: Goal) => void }): React.JSX.Element {
  const status = useStatus().data;
  const today = status?.today ?? '';
  const [kind, setKind] = useState<AreaKind | ''>(area);
  const [title, setTitle] = useState('');
  const [measure, setMeasure] = useState<Measure>('none');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [deadline, setDeadline] = useState('');
  const [milestones, setMilestones] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const pick = (i: GoalIdea): void => {
    setTitle(i.title);
    setMeasure(i.measure);
    setTarget(i.target ?? '');
    setUnit(i.unit ?? (i.measure === 'weight' ? (status?.units === 'imperial' ? 'lb' : 'kg') : ''));
    setMilestones(i.milestones ?? []);
    setDeadline(i.months !== undefined ? monthsAhead(today, i.months) : i.measure === 'books' ? today.slice(0, 4) + '-12-31' : '');
  };
  const needsTarget = measure === 'pot' || measure === 'number_up' || measure === 'number_down' || measure === 'weight' || measure === 'books';
  const make = async (): Promise<void> => {
    if (kind === '' || title.trim() === '') return;
    setBusy(true);
    try {
      const params: Record<string, unknown> = { title: title.trim(), area: kind, measure };
      if (needsTarget && target.trim() !== '') params.target = target.trim();
      if (unit.trim() !== '') params.unit = unit.trim();
      if (deadline !== '') params.deadline = deadline;
      if (measure === 'milestones' && milestones.length > 0) params.milestones = JSON.stringify(milestones);
      if (measure === 'number_down' || measure === 'number_up') params.baseline = measure === 'number_up' ? '0' : target.trim() !== '' ? target.trim() : '0';
      if (measure === 'number_down') params.target = '0';
      const r = await op<{ goal: Goal }>('goals.create', params);
      goalsChanged();
      snack(`New goal: ${r.goal.title}`);
      onMade(r.goal);
    } finally {
      setBusy(false);
    }
  };
  const ideas = kind !== '' ? IDEAS[kind] : [];
  return (
    <Modal
      open
      onClose={onClose}
      title="A new goal"
      width={600}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={kind === '' || title.trim() === '' || (measure === 'pot' && target.trim() === '')} onClick={() => void make()}>
            Start this goal
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <div>
          <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Which part of life</p>
          <AreaChoice value={kind} onChange={setKind} allowNone={false} size="sm" />
        </div>
        {ideas.length > 0 && (
          <div>
            <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Ideas</p>
            <div className="flex flex-wrap gap-1.5">
              {ideas.map((i) => (
                <Chip key={i.title} active={title === i.title} tone={kind} onClick={() => pick(i)}>
                  {i.title}
                </Chip>
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="pb-1 text-[12px] font-bold text-[var(--lo-muted)]">The goal</p>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void make();
            }}
            placeholder="In your own words"
            maxLength={200}
            className="h-11 w-full rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[15px] font-semibold outline-none focus:border-[var(--lo-accent)]"
          />
        </div>
        <div>
          <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">How it counts</p>
          <div className="flex flex-wrap gap-1.5">
            {MEASURE_CHOICES.map((m) => (
              <Chip key={m.value} active={measure === m.value} title={m.hint} onClick={() => setMeasure(m.value)}>
                {m.label}
              </Chip>
            ))}
          </div>
        </div>
        {needsTarget && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-[var(--lo-muted)]">{measure === 'pot' ? `How much (${status?.currency ?? ''})` : measure === 'number_down' ? 'Where it is now' : measure === 'books' ? 'How many books' : 'Aim for'}</span>
              <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder={measure === 'pot' ? '1500' : '10'} className="num h-10 w-36 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[15px] font-bold outline-none focus:border-[var(--lo-accent)]" />
            </label>
            {(measure === 'number_up' || measure === 'number_down' || measure === 'weight') && (
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-bold text-[var(--lo-muted)]">Unit</span>
                <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="km" maxLength={30} className="h-10 w-28 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[14px] font-semibold outline-none focus:border-[var(--lo-accent)]" />
              </label>
            )}
          </div>
        )}
        {measure === 'milestones' && (
          <div>
            <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Milestones</p>
            <ul className="mb-1.5 flex flex-col gap-1">
              {milestones.map((m, i) => (
                <li key={m + i} className="flex h-9 items-center gap-2 rounded-[var(--lo-r-sm)] bg-[var(--lo-sunk)] px-3 text-[14px]">
                  <span className="num text-[12px] font-extrabold text-[var(--lo-muted)]">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{m}</span>
                  <button type="button" aria-label={`Remove ${m}`} onClick={() => setMilestones(milestones.filter((_, j) => j !== i))} className="flex size-6 items-center justify-center rounded-[var(--lo-r-xs)] text-[var(--lo-muted)] hover:bg-[var(--lo-card)]">
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
            <AddLine placeholder="Add a milestone" onAdd={(t) => setMilestones([...milestones, t])} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="whitespace-nowrap text-[12px] font-bold text-[var(--lo-muted)]">By when</span>
          <DateButton value={deadline} today={today} onChange={setDeadline} placeholder="No date" />
          {[3, 6, 12].map((n) => (
            <Chip key={n} active={deadline === monthsAhead(today, n)} onClick={() => setDeadline(monthsAhead(today, n))}>
              {n === 12 ? 'A year' : `${n} months`}
            </Chip>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------- one goal */

function NumberCheckin({ goal, onDone }: { goal: GoalDetail; onDone: () => void }): React.JSX.Element {
  const [v, setV] = useState('');
  const save = async (): Promise<void> => {
    const n = Number(v.replace(',', '.'));
    if (v.trim() === '' || Number.isNaN(n)) return;
    setV('');
    snack(`Noted ${figure(n)}${goal.unit !== '' ? ' ' + goal.unit : ''}`);
    await act([patch<Goal>(goal.id, { current: n })], () => op('goals.checkin', { goal: goal.id, value: n }), ['goals', 'goal_checkins']);
    onDone();
  };
  return (
    <div className="flex items-center gap-2">
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} inputMode="decimal" placeholder={figure(goal.current)} aria-label="Where it is now" className="num h-10 w-32 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[15px] font-bold outline-none focus:border-[var(--lo-accent)]" />
      {goal.unit !== '' && <span className="text-[14px] font-semibold text-[var(--lo-muted)]">{goal.unit}</span>}
      <Button variant="primary" size="md" disabled={v.trim() === ''} onClick={() => void save()}>
        Note it
      </Button>
    </div>
  );
}

function PotAdd({ goal, onDone }: { goal: GoalDetail; onDone: () => void }): React.JSX.Element | null {
  const fmt = useMoney();
  const [v, setV] = useState('');
  if (goal.pot === null) return null;
  const pot = goal.pot;
  const add = async (amount: string, take = false): Promise<void> => {
    if (amount.trim() === '') return;
    await op('pots.add', { pot: pot.id, amount: amount.trim(), take });
    goalsChanged();
    changed('money_pots', 'money_entries');
    setV('');
    snack(take ? 'Taken out of the jar' : 'Into the jar');
    onDone();
  };
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Jar fill={pot.target > 0 ? pot.saved / pot.target : 0} size={84} label={`${fmt(pot.saved)} saved`} />
      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-semibold">
          <span className="num text-[15px] font-extrabold">{fmt(pot.saved)}</span> saved of <span className="num font-bold">{fmt(pot.target)}</span>
        </p>
        <div className="flex items-center gap-2">
          <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add(v)} inputMode="decimal" placeholder="50" aria-label="Amount" className="num h-10 w-28 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[15px] font-bold outline-none focus:border-[var(--lo-accent)]" />
          <Button variant="primary" disabled={v.trim() === ''} onClick={() => void add(v)}>
            Put in
          </Button>
          <Button variant="ghost" size="sm" disabled={v.trim() === ''} onClick={() => void add(v, true)}>
            Take out
          </Button>
        </div>
      </div>
    </div>
  );
}

function Milestones({ goal, onDone }: { goal: GoalDetail; onDone: () => void }): React.JSX.Element {
  const act = async (params: Record<string, unknown>): Promise<void> => {
    await op('goals.milestone', { goal: goal.id, ...params });
    goalsChanged();
    onDone();
  };
  return (
    <div>
      <ol className="relative flex flex-col gap-1 pl-1">
        {goal.milestones.map((m, i) => (
          <li key={m.id} className="group flex min-h-10 items-center gap-3 rounded-[var(--lo-r-sm)] px-2 hover:bg-[var(--lo-sunk)]">
            <CheckButton done={m.done} kind={goal.area} onClick={() => void act({ item: m.id, done: !m.done })} label={m.text} />
            <span className={cn('min-w-0 flex-1 text-[14px] font-semibold', m.done && 'text-[var(--lo-muted)] line-through')}>
              <span className="num mr-1.5 text-[12px] font-extrabold text-[var(--lo-muted)]">{i + 1}</span>
              {m.text}
            </span>
            <button type="button" aria-label={`Remove ${m.text}`} onClick={() => void act({ item: m.id, remove: true })} className="hit flex size-7 items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-muted)] opacity-0 hover:bg-[var(--lo-card)] focus:opacity-100 group-hover:opacity-100">
              <X size={14} />
            </button>
          </li>
        ))}
      </ol>
      <AddLine placeholder="Add a milestone" onAdd={(text) => act({ text })} className="mt-1.5" />
    </div>
  );
}

function GoalDrawer({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const status = useStatus().data;
  const fmt = useMoney();
  const live = useLive<{ goal: GoalDetail }>((signal) => op('goals.get', { goal: id }, { quiet: true, signal }), ['goals', 'goal_checkins', 'money_pots', 'tasks', 'habits', 'habit_logs', 'projects', 'books', 'health_logs'], [id]);
  const [confirmEl, confirm] = useConfirm();
  const g = live.data?.goal;
  const today = status?.today ?? '';
  const GOAL_READS = ['goals', 'goal_checkins', 'tasks', 'habits', 'habit_logs', 'money_pots', 'books', 'projects'] as const;
  const save = async (fields: Record<string, unknown>): Promise<void> => {
    await act([patch<Goal>(id, fields as Partial<Goal>)], () => op('goals.update', { goal: id, ...fields }), [...GOAL_READS]);
  };
  const setState = async (state: Goal['state']): Promise<void> => {
    if (state === 'done') snack('Goal reached. Well done');
    await act([patch<Goal>(id, { state })], () => op('goals.set-state', { goal: id, state }), [...GOAL_READS]);
  };
  const remove = async (): Promise<void> => {
    if (g === undefined) return;
    if (!(await confirm(`"${g.title}" will be deleted. Its tasks and habits stay. You can undo it right after.`, 'Delete this goal?'))) return;
    onClose();
    const r = await act([drop(id)], () => op('goals.delete', { goal: id }), [...GOAL_READS]);
    if (r !== undefined) snack(`Deleted "${g.title}"`);
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title={g !== undefined ? `A goal for ${AREA_NAMES[g.area].toLowerCase()}` : 'Goal'}
      width={560}
      footer={
        g !== undefined ? (
          <>
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => void remove()}>
              Delete
            </Button>
            <div className="flex gap-2">
              {g.state === 'active' && (
                <Button variant="ghost" size="sm" icon={Pause} onClick={() => void setState('paused')}>
                  Pause
                </Button>
              )}
              {g.state !== 'active' && (
                <Button variant="soft" size="sm" icon={Play} onClick={() => void setState('active')}>
                  Pick it up again
                </Button>
              )}
              {g.state !== 'done' && (
                <Button variant="primary" size="sm" icon={Check} onClick={() => void setState('done')}>
                  Reached it
                </Button>
              )}
            </div>
          </>
        ) : undefined
      }
    >
      {confirmEl}
      {g === undefined ? (
        <div className="flex flex-col gap-3 p-5">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <div className="pb-6">
          <div className="px-5 pb-4 pt-5" style={{ background: kindColor(g.area, 'soft') }}>
            <p className="flex items-center gap-1.5 text-[12px] font-extrabold" style={{ color: kindColor(g.area, 'text') }}>
              <AreaArt kind={g.area} size={18} /> {AREA_NAMES[g.area]}
            </p>
            <InlineText value={g.title} onSave={(v) => save({ title: v })} placeholder="The goal" ariaLabel="Goal" className="serif mt-1 text-[26px] font-semibold leading-9" maxLength={200} />
            <div className="mt-3 flex items-end gap-4">
              <p className="num text-[26px] font-extrabold leading-8">{Math.round(g.progress * 100)}%</p>
              <div className="min-w-0 flex-1 pb-1 text-[13px] font-semibold text-[var(--lo-ink-2)]">
                <p>{goalNumbers(g, (m) => fmt(m))}</p>
                <p className="text-[12px] text-[var(--lo-muted)]">
                  {g.source}
                  {g.deadline !== '' ? ` · by ${relDay(g.deadline, today)}` : ''}
                  {g.pace_state !== 'none' && PACE_WORDS[g.pace_state] !== undefined ? ` · ${PACE_WORDS[g.pace_state]}` : ''}
                </p>
              </div>
            </div>
            <div className="mt-3 pr-6">
              <Trail progress={g.progress} pace={g.pace} kind={g.area} height={56} />
            </div>
          </div>

          <div className="flex flex-col gap-5 px-5 pt-5">
            {(g.measure === 'number_up' || g.measure === 'number_down') && (
              <div>
                <p className="pb-2 text-[12px] font-bold text-[var(--lo-muted)]">Where is it now?</p>
                <NumberCheckin goal={g} onDone={live.reload} />
              </div>
            )}
            {g.measure === 'pot' && <PotAdd goal={g} onDone={live.reload} />}
            {g.measure === 'weight' && <p className="text-[13px] text-[var(--lo-ink-2)]">Weigh-ins from Health move this goal. Last one: {figure(g.current)}{g.unit !== '' ? ' ' + g.unit : ''}.</p>}
            {g.measure === 'books' && <p className="text-[13px] text-[var(--lo-ink-2)]">Every book you finish on your shelf in Growth counts.</p>}
            {g.measure === 'milestones' && <Milestones goal={g} onDone={live.reload} />}
            {g.measure === 'none' && g.state !== 'done' && <p className="text-[13px] text-[var(--lo-ink-2)]">Tick it off with Reached it when it is done.</p>}

            {(g.measure === 'habits' || g.habits.length > 0) && (
              <div>
                <p className="pb-2 text-[12px] font-bold text-[var(--lo-muted)]">Habits for it</p>
                {g.habits.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-3">
                    {g.habits.map((h) => (
                      <HabitTile key={h.id} habit={h} size="sm" />
                    ))}
                  </div>
                )}
                <HabitIdeas have={g.habits} area={g.area} goal={g.id} limit={6} onAdded={() => live.reload()} />
              </div>
            )}

            <div>
              <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Next steps {g.done_tasks > 0 && <span>({g.done_tasks} done)</span>}</p>
              <div className="flex flex-col">
                {g.tasks
                  .filter((t) => t.state === 'open')
                  .map((t) => (
                    <TaskRow key={t.id} task={t} today={today} showArea={false} />
                  ))}
              </div>
              <QuickAdd defaults={{ goal: g.id, area: g.area, column: 'inbox' }} placeholder="Add a next step" className="mt-1.5" />
              <div className="mt-2">
                <AgentButton kind="breakdown" params={{ goal: g.id }} label="Ask your AI agent for steps" size="sm" variant="ghost" />
              </div>
            </div>

            {g.measure === 'habits' && g.habits.length === 0 && (
              <p className="text-[13px] text-[var(--lo-muted)]">
                <HabitArt art="sprout" size={18} className="mr-1 inline" /> Start a habit above and this goal fills as you keep it.
              </p>
            )}

            <div className="border-t border-[var(--lo-hair)] pt-4">
              <p className="pb-1 text-[12px] font-bold text-[var(--lo-muted)]">Why it matters</p>
              <InlineText multiline value={g.purpose} onSave={(v) => save({ purpose: v })} placeholder="So that..." className="text-[14px] leading-6" maxLength={1000} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-bold text-[var(--lo-muted)]">By when</span>
              <DateButton value={g.deadline} today={today} onChange={(d) => void save({ deadline: d })} placeholder="No date" />
            </div>
            <div>
              <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Area of life</p>
              <AreaChoice value={g.area} onChange={(k) => k !== '' && void save({ area: k })} allowNone={false} size="sm" />
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/** A dashed "new goal" button for an area. */
export function NewGoalButton({ area, label = 'New goal' }: { area?: AreaKind | undefined; label?: string | undefined }): React.JSX.Element {
  const panel = useGoalPanel();
  return (
    <button type="button" onClick={() => panel.create(area)} className="flex h-10 w-full items-center gap-2 rounded-[var(--lo-r)] border border-dashed border-[var(--lo-line)] px-3 text-[13px] font-bold text-[var(--lo-ink-2)] transition-colors hover:border-solid hover:border-[var(--lo-moss)] hover:text-[var(--lo-ink)]">
      <span className="flex size-6 items-center justify-center rounded-[var(--lo-r-sm)] bg-[var(--lo-primary)] text-white">
        <Plus size={15} strokeWidth={3} />
      </span>
      {label}
    </button>
  );
}
