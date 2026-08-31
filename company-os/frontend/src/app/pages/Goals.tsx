/**
 * Goals: priorities as Linear-style one-row cards (health pill + owner chip),
 * year goals beneath, and the Numbers tab as an EOS scorecard: sticky metric
 * column with per-row sparkline + goal, current week highlighted and
 * editable, pass/fail tinted cells, 4-week average column.
 */
import { useState } from 'react';
import { BarChart3, Map, Plus, Target } from 'lucide-react';
import {
  Button,
  Dialog,
  EntityForm,
  Input,
  Sparkline,
  getPbClient,
  toast,
  useCollection,
  useConfirm,
  cn,
} from '../../kit/index.ts';
import type { EntityField } from '../../kit/index.ts';
import type { Goal, Metric, MetricEntry, Priority, TeamMember } from '../lib/types.ts';
import {
  Advanced,
  DeleteButton,
  EditButton,
  GhostRows,
  GhostState,
  GroupHeader,
  IdentityChip,
  ListRow,
  PageHeader,
  Pill,
  fmtMoney,
} from '../components/ui.tsx';
import { currentQuarter, weekStart } from '../lib/useCompany.ts';
import { RoadmapCanvas } from '../components/RoadmapCanvas.tsx';

type GoalsTab = 'goals' | 'numbers' | 'roadmap';
const TAB_LABELS: Record<GoalsTab, string> = { goals: 'Goals', numbers: 'Numbers', roadmap: 'Roadmap' };
const TAB_ICONS: Record<GoalsTab, typeof Target> = { goals: Target, numbers: BarChart3, roadmap: Map };

const GOAL_FIELDS: EntityField[] = [
  { name: 'title', type: 'text', required: true },
  { name: 'year', type: 'number', required: true },
  {
    name: 'status',
    type: 'select',
    required: true,
    options: [
      { value: 'active', label: 'Active' },
      { value: 'reached', label: 'Reached' },
      { value: 'dropped', label: 'Dropped' },
    ],
  },
  { name: 'measure', label: 'How you will measure it (optional)', type: 'text' },
];

const PRIORITY_FIELDS: EntityField[] = [
  { name: 'title', type: 'text', required: true },
  { name: 'quarter', type: 'text', required: true, placeholder: 'e.g. 2026-Q3' },
  { name: 'owner_member', label: 'Owner', type: 'ref', ref: { collection: 'team_members', labelField: 'name' } },
  {
    name: 'status',
    type: 'select',
    required: true,
    options: [
      { value: 'on_track', label: 'On track' },
      { value: 'at_risk', label: 'At risk' },
      { value: 'done', label: 'Done' },
    ],
  },
  { name: 'note', type: 'textarea' },
];

const METRIC_FIELDS: EntityField[] = [
  { name: 'name', type: 'text', required: true },
  { name: 'goal', label: 'Weekly goal (optional)', type: 'number' },
  { name: 'unit', type: 'text', placeholder: 'e.g. %, h' },
  {
    name: 'direction',
    label: 'Which way is good?',
    type: 'select',
    required: true,
    options: [
      { value: 'up', label: 'Higher is better' },
      { value: 'down', label: 'Lower is better' },
    ],
  },
  { name: 'owner_member', label: 'Owner', type: 'ref', ref: { collection: 'team_members', labelField: 'name' } },
  { name: 'order', type: 'number' },
  { name: 'active', type: 'boolean' },
];

function lastWeeks(n: number): string[] {
  const weeks: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    weeks.push(weekStart(d));
  }
  return weeks;
}

export function GoalsPage(): React.JSX.Element {
  const [tab, setTab] = useState<GoalsTab>('goals');
  const [goalOpen, setGoalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [editingPriority, setEditingPriority] = useState<Priority | null>(null);
  const [metricOpen, setMetricOpen] = useState(false);
  const [editingMetric, setEditingMetric] = useState<Metric | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { records: priorities } = useCollection<Priority>('priorities', { sort: '-created' });
  const { records: goals } = useCollection<Goal>('goals', { sort: '-year' });
  const { records: members } = useCollection<TeamMember>('team_members');
  const [confirmEl, confirm] = useConfirm();

  const memberName = (id: string): string => members.find((m) => m.id === id)?.name ?? '';

  const removePriority = async (p: Priority): Promise<void> => {
    if (!(await confirm('Delete this priority?'))) return;
    await getPbClient()
      .call((pb) => pb.collection('priorities').delete(p.id))
      .catch(() => undefined);
  };
  const removeGoal = async (g: Goal): Promise<void> => {
    if (!(await confirm('Delete this goal?'))) return;
    await getPbClient()
      .call((pb) => pb.collection('goals').delete(g.id))
      .catch(() => undefined);
  };

  return (
    <div>
      <PageHeader
        icon={Target}
        title="Goals"
        actions={
          tab === 'goals' ? (
            <Button
              size="sm"
              onClick={() => {
                setEditingPriority(null);
                setPriorityOpen(true);
              }}
            >
              <Plus size={14} aria-hidden />
              Add priority
            </Button>
          ) : tab === 'numbers' ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditingMetric(null);
                setMetricOpen(true);
              }}
            >
              <Plus size={14} aria-hidden />
              Add metric
            </Button>
          ) : undefined
        }
      />

      {/* simple two-tab control kept inline so the header action can follow the tab */}
      <div className="mb-4 flex gap-1 border-b border-[var(--lui-border)]">
        {(['goals', 'numbers', 'roadmap'] as const).map((t) => {
          const Icon = TAB_ICONS[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-2 text-[13px] transition-colors',
                tab === t ? 'font-medium text-[var(--lui-text)]' : 'text-[var(--lui-muted)] hover:text-[var(--lui-text)]',
              )}
              aria-selected={tab === t}
              role="tab"
            >
              <Icon size={14} aria-hidden />
              {TAB_LABELS[t]}
              {tab === t && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-[var(--lui-accent)]" />}
            </button>
          );
        })}
      </div>

      {tab === 'roadmap' ? (
        <RoadmapCanvas />
      ) : tab === 'goals' ? (
        <div className="flex flex-col gap-5">
          <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
            <GroupHeader label={`Priorities · ${currentQuarter()}`} count={priorities.length} />
            {priorities.length === 0 ? (
              <div>
                <GhostRows rows={2} chip={false} />
                <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2 border-t border-[var(--lui-border)]/60 px-4 py-3 text-center">
                  <span className="text-[13px] text-[var(--lui-muted)]">
                    Three to seven things that matter most in the next 90 days, each with one owner.
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => setPriorityOpen(true)}>
                    Add the first priority
                  </Button>
                </div>
              </div>
            ) : (
              priorities.map((p) => {
                const owner = memberName(p.owner_member);
                return (
                  <ListRow
                    key={p.id}
                    leading={owner !== '' ? <IdentityChip name={owner} size="sm" /> : undefined}
                    primary={p.title}
                    secondary={p.note !== '' ? p.note : undefined}
                    trailing={
                      <>
                        <span className="hidden text-xs text-[var(--lui-muted)] sm:inline">{p.quarter}</span>
                        <Pill tone={p.status === 'on_track' ? 'good' : p.status === 'at_risk' ? 'warn' : 'neutral'}>
                          {p.status === 'on_track' ? 'On track' : p.status === 'at_risk' ? 'At risk' : 'Done'}
                        </Pill>
                      </>
                    }
                    hoverActions={
                      <>
                        <EditButton
                          onClick={() => {
                            setEditingPriority(p);
                            setPriorityOpen(true);
                          }}
                        />
                        <DeleteButton onClick={() => void removePriority(p)} />
                      </>
                    }
                    onClick={() => {
                      setEditingPriority(p);
                      setPriorityOpen(true);
                    }}
                  />
                );
              })
            )}
          </div>

          <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
            <GroupHeader
              label="Goals for the year"
              count={goals.length}
              right={
                <Button variant="ghost" size="sm" onClick={() => setGoalOpen(true)}>
                  <Plus size={13} aria-hidden />
                  Add goal
                </Button>
              }
            />
            {goals.length === 0 ? (
              <div>
                <GhostRows rows={2} chip={false} />
                <p className="border-t border-[var(--lui-border)]/60 px-4 py-3 text-center text-[13px] text-[var(--lui-muted)]">
                  Where should the company be in a year? Write it down and check quarterly.
                </p>
              </div>
            ) : (
              goals.map((g) => (
                <ListRow
                  key={g.id}
                  primary={g.title}
                  secondary={g.measure !== '' ? `Measured by: ${g.measure}` : undefined}
                  trailing={
                    <>
                      <span className="text-xs tabular-nums text-[var(--lui-muted)]">{g.year}</span>
                      <Pill tone={g.status === 'reached' ? 'good' : g.status === 'dropped' ? 'neutral' : 'info'}>
                        {g.status === 'reached' ? 'Reached' : g.status === 'dropped' ? 'Dropped' : 'Active'}
                      </Pill>
                    </>
                  }
                  hoverActions={
                    <>
                      <EditButton
                        onClick={() => {
                          setEditingGoal(g);
                          setGoalOpen(true);
                        }}
                      />
                      <DeleteButton onClick={() => void removeGoal(g)} />
                    </>
                  }
                  onClick={() => {
                    setEditingGoal(g);
                    setGoalOpen(true);
                  }}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        <div>
          <ScorecardGrid />
          <Advanced label="Manage metrics" open={advancedOpen} onToggle={() => setAdvancedOpen(!advancedOpen)}>
            <MetricManager
              onEdit={(m) => {
                setEditingMetric(m);
                setMetricOpen(true);
              }}
            />
          </Advanced>
        </div>
      )}

      {confirmEl}

      <Dialog open={goalOpen} onOpenChange={setGoalOpen} title={editingGoal !== null ? 'Edit goal' : 'Add goal'}>
        <EntityForm
          collection="goals"
          fields={GOAL_FIELDS}
          {...(editingGoal !== null
            ? { initial: editingGoal }
            : { defaults: { status: 'active', year: new Date().getFullYear() } })}
          onSaved={() => {
            setGoalOpen(false);
            setEditingGoal(null);
          }}
          onCancel={() => {
            setGoalOpen(false);
            setEditingGoal(null);
          }}
        />
      </Dialog>
      <Dialog
        open={priorityOpen}
        onOpenChange={setPriorityOpen}
        title={editingPriority !== null ? 'Edit priority' : 'Add priority'}
      >
        <EntityForm
          collection="priorities"
          fields={PRIORITY_FIELDS}
          {...(editingPriority !== null
            ? { initial: editingPriority }
            : { defaults: { status: 'on_track', quarter: currentQuarter() } })}
          onSaved={() => {
            setPriorityOpen(false);
            setEditingPriority(null);
          }}
          onCancel={() => {
            setPriorityOpen(false);
            setEditingPriority(null);
          }}
        />
      </Dialog>
      <Dialog
        open={metricOpen}
        onOpenChange={setMetricOpen}
        title={editingMetric !== null ? 'Edit metric' : 'Add metric'}
      >
        <EntityForm
          collection="metrics"
          fields={METRIC_FIELDS}
          {...(editingMetric !== null ? { initial: editingMetric } : { defaults: { direction: 'up', active: true } })}
          onSaved={() => {
            setMetricOpen(false);
            setEditingMetric(null);
          }}
          onCancel={() => {
            setMetricOpen(false);
            setEditingMetric(null);
          }}
        />
      </Dialog>
    </div>
  );
}

function MetricManager({ onEdit }: { onEdit: (m: Metric) => void }): React.JSX.Element {
  const { records: metrics } = useCollection<Metric>('metrics', { sort: 'order' });
  const { records: entries } = useCollection<MetricEntry>('metric_entries');
  const [confirmEl, confirm] = useConfirm();

  const remove = async (m: Metric): Promise<void> => {
    const n = entries.filter((e) => e.metric === m.id).length;
    const extra = n > 0 ? ` Its ${n} weekly value${n === 1 ? '' : 's'} will be removed too.` : '';
    if (!(await confirm(`Delete metric "${m.name}"?${extra}`))) return;
    await getPbClient()
      .call((pb) => pb.collection('metrics').delete(m.id))
      .catch(() => undefined);
  };

  return (
    <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
      {metrics.map((m) => (
        <ListRow
          key={m.id}
          primary={m.name}
          secondary={`${m.direction === 'down' ? 'Lower' : 'Higher'} is better${m.goal > 0 ? ` · goal ${fmtMoney(m.goal)}${m.unit !== '' ? ` ${m.unit}` : ''}` : ''}`}
          trailing={<Pill tone={m.active ? 'good' : 'neutral'}>{m.active ? 'Active' : 'Off'}</Pill>}
          hoverActions={
            <>
              <EditButton onClick={() => onEdit(m)} />
              <DeleteButton onClick={() => void remove(m)} />
            </>
          }
          onClick={() => onEdit(m)}
        />
      ))}
      {confirmEl}
    </div>
  );
}

function ScorecardGrid(): React.JSX.Element {
  const weeks = lastWeeks(8);
  const currentWeek = weeks[weeks.length - 1] ?? '';
  const { records: metrics } = useCollection<Metric>('metrics', { filter: 'active = true', sort: 'order' });
  const { records: entries } = useCollection<MetricEntry>('metric_entries');
  const { records: members } = useCollection<TeamMember>('team_members');

  if (metrics.length === 0) {
    return (
      <GhostState
        icon={Target}
        title="No metrics yet"
        message="A handful of weekly numbers, each with an owner and a goal, beats any monthly report. Add your first metric with the button above."
      >
        <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
          <GhostRows rows={4} chip={false} />
        </div>
      </GhostState>
    );
  }

  const valueOf = (m: Metric, w: string): MetricEntry | undefined =>
    entries.find((e) => e.metric === m.id && e.week_start.slice(0, 10) === w);

  return (
    <div className="w-full overflow-x-auto border border-[var(--lui-border)] bg-[var(--lui-surface)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--lui-border)] text-left">
            <th className="sticky left-0 z-10 min-w-44 bg-[var(--lui-surface)] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--lui-muted)]">
              Metric
            </th>
            {weeks.map((w) => (
              <th
                key={w}
                className={cn(
                  'whitespace-nowrap px-1 py-2.5 text-center text-[11px] font-medium tabular-nums',
                  w === currentWeek
                    ? 'bg-[var(--lui-accent)]/[0.07] font-semibold text-[var(--lui-accent)]'
                    : 'text-[var(--lui-muted)]',
                )}
              >
                {new Date(w + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </th>
            ))}
            <th className="whitespace-nowrap px-2 py-2.5 text-center text-[11px] font-medium text-[var(--lui-muted)]">
              4-wk avg
            </th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => {
            const series = weeks.map((w) => valueOf(m, w)?.value ?? null);
            const known = series.filter((v): v is number => v !== null);
            const last4 = series.slice(-4).filter((v): v is number => v !== null);
            const avg4 = last4.length > 0 ? last4.reduce((a, b) => a + b, 0) / last4.length : null;
            const owner = members.find((mm) => mm.id === m.owner_member)?.name ?? '';
            return (
              <tr key={m.id} className="border-b border-[var(--lui-border)]/70 last:border-0">
                <td className="sticky left-0 z-10 bg-[var(--lui-surface)] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{m.name}</p>
                      <p className="text-[11px] text-[var(--lui-muted)]">
                        {m.goal > 0
                          ? `goal ${m.direction === 'down' ? '≤' : '≥'} ${fmtMoney(m.goal)}${m.unit !== '' ? ` ${m.unit}` : ''}`
                          : 'no goal set'}
                        {owner !== '' ? ` · ${owner}` : ''}
                      </p>
                    </div>
                    {known.length > 1 && <Sparkline values={known} width={56} height={18} />}
                  </div>
                </td>
                {weeks.map((w) => (
                  <ScoreCell key={w} metric={m} week={w} entry={valueOf(m, w)} current={w === currentWeek} />
                ))}
                <td className="px-2 py-2 text-center text-xs tabular-nums text-[var(--lui-muted)]">
                  {avg4 !== null ? fmtMoney(Math.round(avg4 * 10) / 10) : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScoreCell({
  metric,
  week,
  entry,
  current,
}: {
  metric: Metric;
  week: string;
  entry: MetricEntry | undefined;
  current: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    if (draft === null) return;
    const trimmed = draft.trim();
    setDraft(null);
    if (trimmed === '' && entry === undefined) return;
    try {
      if (trimmed === '' && entry !== undefined) {
        await getPbClient().call((pb) => pb.collection('metric_entries').delete(entry.id));
        return;
      }
      const value = Number(trimmed);
      if (Number.isNaN(value)) {
        toast.error('Numbers only');
        return;
      }
      if (entry !== undefined) {
        await getPbClient().call((pb) => pb.collection('metric_entries').update(entry.id, { value }));
      } else {
        await getPbClient().call((pb) =>
          pb.collection('metric_entries').create({ metric: metric.id, week_start: week, value }),
        );
      }
    } catch {
      /* surfaced by shell */
    }
  };

  const value = entry?.value;
  const hasGoal = metric.goal > 0 && value !== undefined;
  const good = hasGoal && (metric.direction === 'up' ? value >= metric.goal : value <= metric.goal);

  return (
    <td className={cn('px-0.5 py-1 text-center', current && 'bg-[var(--lui-accent)]/[0.05]')}>
      <Input
        aria-label={`${metric.name}, week of ${week}`}
        className={cn(
          'h-8 w-14 border-transparent bg-transparent text-center text-[13px] tabular-nums transition-colors hover:border-[var(--lui-border)]',
          hasGoal && (good ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/10 text-red-700 dark:text-red-400'),
        )}
        value={draft ?? (value !== undefined ? String(value) : '')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        inputMode="decimal"
      />
    </td>
  );
}
