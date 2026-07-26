/**
 * Habit Tracker — categories → habits → daily entries.
 * A 14-day grid (click to toggle / log values with notes), a per-habit
 * detail panel with a year heatmap and trend chart, and a category manager.
 */
import { useMemo, useState } from 'react';
import type { RecordModel } from 'pocketbase';
import {
  Badge,
  Button,
  Dialog,
  Input,
  getPbClient,
  toast,
  useCollection,
} from '../kit/index.ts';

interface Category extends RecordModel {
  name: string;
  color: string;
  order: number;
}

interface Habit extends RecordModel {
  name: string;
  description: string;
  type: '' | 'binary' | 'quantity';
  target: number;
  unit: string;
  color: string;
  icon: string;
  category: string;
  order: number;
  archived: boolean;
}

interface Entry extends RecordModel {
  habit: string;
  day: string;
  value: number;
  note: string;
}

const DAYS_SHOWN = 14;
const PALETTE = ['#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6'];
const ICONS = ['🏃', '💧', '😴', '🎯', '📚', '🧘', '🥗', '💪', '✍️', '🎸', '🚭', '💊'];

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function lastDays(count: number): string[] {
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push(dayKey(date));
  }
  return days;
}

function targetOf(habit: Habit): number {
  return habit.type === 'quantity' ? (habit.target > 0 ? habit.target : 1) : 1;
}

function isDone(habit: Habit, entry: Entry | undefined): boolean {
  return entry !== undefined && entry.value >= targetOf(habit);
}

export function App(): React.JSX.Element {
  const { records: categories } = useCollection<Category>('categories', { sort: 'order' });
  // One hook per collection: PocketBase auto-cancels concurrent identical
  // requests, so two useCollection calls on 'habits' would starve each
  // other. Fetch all habits once and split active/archived here.
  const { records: allHabits, loading } = useCollection<Habit>('habits', { sort: 'order' });
  const { records: entries } = useCollection<Entry>('entries', { sort: '-day' });
  const habits = allHabits.filter((habit) => !habit.archived);
  const archived = allHabits.filter((habit) => habit.archived);
  const [formHabit, setFormHabit] = useState<Habit | 'new' | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [manageCategories, setManageCategories] = useState(false);
  const [manageArchived, setManageArchived] = useState(false);
  const [logTarget, setLogTarget] = useState<{ habit: Habit; day: string } | null>(null);

  /** Reorder a habit within the full ordered list (renumbered 0..n). */
  const moveHabit = async (habitId: string, delta: number): Promise<void> => {
    const ordered = [...habits].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((h) => h.id === habitId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= ordered.length) return;
    const [item] = ordered.splice(index, 1);
    ordered.splice(target, 0, item!);
    try {
      for (let i = 0; i < ordered.length; i++) {
        if (ordered[i]!.order === i) continue;
        await getPbClient().call((pb) => pb.collection('habits').update(ordered[i]!.id, { order: i }));
      }
    } catch {
      /* surfaced by shell */
    }
  };

  const days = useMemo(() => lastDays(DAYS_SHOWN), []);
  const today = days[days.length - 1]!;
  const detailHabit = detailId === null ? null : (habits.find((h) => h.id === detailId) ?? null);

  const entryMap = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const entry of entries) map.set(`${entry.habit}|${entry.day}`, entry);
    return map;
  }, [entries]);

  const streakOf = (habit: Habit): number => {
    let streak = 0;
    const cursor = new Date();
    if (!isDone(habit, entryMap.get(`${habit.id}|${dayKey(cursor)}`))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    for (;;) {
      if (isDone(habit, entryMap.get(`${habit.id}|${dayKey(cursor)}`))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  };

  const weekRate = (habit: Habit): number => {
    const week = days.slice(-7);
    const done = week.filter((day) => isDone(habit, entryMap.get(`${habit.id}|${day}`))).length;
    return Math.round((done / 7) * 100);
  };

  const setEntry = async (habit: Habit, day: string, value: number, note?: string): Promise<void> => {
    const existing = entryMap.get(`${habit.id}|${day}`);
    try {
      if (value <= 0 && (note === undefined || note === '')) {
        if (existing !== undefined) {
          await getPbClient().call((pb) => pb.collection('entries').delete(existing.id));
        }
      } else if (existing !== undefined) {
        await getPbClient().call((pb) =>
          pb.collection('entries').update(existing.id, { value, note: note ?? existing.note }),
        );
      } else {
        await getPbClient().call((pb) =>
          pb.collection('entries').create({ habit: habit.id, day, value, note: note ?? '' }),
        );
      }
    } catch {
      /* surfaced by shell */
    }
  };

  const onCellClick = (habit: Habit, day: string): void => {
    if (habit.type === 'quantity') {
      setLogTarget({ habit, day });
      return;
    }
    const existing = entryMap.get(`${habit.id}|${day}`);
    void setEntry(habit, day, existing !== undefined && existing.value >= 1 ? 0 : 1);
  };

  const grouped: { category: Category | null; habits: Habit[] }[] = useMemo(() => {
    const groups = categories.map((category) => ({
      category: category as Category | null,
      habits: habits.filter((habit) => habit.category === category.id),
    }));
    const uncategorized = habits.filter(
      (habit) => habit.category === '' || !categories.some((c) => c.id === habit.category),
    );
    if (uncategorized.length > 0) groups.push({ category: null, habits: uncategorized });
    return groups.filter((group) => group.habits.length > 0);
  }, [categories, habits]);

  return (
    <div className="flex min-h-screen flex-col p-4">
      <header className="mb-4 flex items-center gap-2">
        <h1 className="text-lg font-semibold">Habit Tracker</h1>
        <Button size="sm" onClick={() => setFormHabit('new')}>
          New habit
        </Button>
        <Button size="sm" variant="outline" onClick={() => setManageCategories(true)}>
          Categories
        </Button>
        {archived.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setManageArchived(true)}>
            Archived ({archived.length})
          </Button>
        )}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="min-w-52 p-2 text-left font-medium opacity-60">Habit</th>
              {days.map((day) => (
                <th
                  key={day}
                  className={`p-1 text-center text-xs font-normal ${day === today ? 'font-semibold' : 'opacity-60'}`}
                >
                  {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric' })}
                  <br />
                  {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}
                </th>
              ))}
              <th className="p-2 text-center text-xs font-normal opacity-60">5w</th>
              <th className="p-2 text-right text-xs font-normal opacity-60">Streak · 7d</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((group) => (
              <GroupRows
                key={group.category?.id ?? 'uncategorized'}
                group={group}
                days={days}
                entryMap={entryMap}
                streakOf={streakOf}
                weekRate={weekRate}
                onCellClick={onCellClick}
                onOpenDetail={(habit) => setDetailId(habit.id)}
                onMoveHabit={(habit, delta) => void moveHabit(habit.id, delta)}
              />
            ))}
          </tbody>
        </table>
        {loading ? (
          <p className="p-6 text-sm opacity-60">Loading habits…</p>
        ) : habits.length === 0 ? (
          <p className="p-6 text-sm opacity-60">No habits yet — create one to start tracking.</p>
        ) : null}
      </div>

      {formHabit !== null && (
        <HabitFormDialog
          habit={formHabit === 'new' ? undefined : formHabit}
          categories={categories}
          onClose={() => setFormHabit(null)}
        />
      )}
      {manageCategories && (
        <CategoryManagerDialog
          categories={categories}
          onClose={() => setManageCategories(false)}
        />
      )}
      {manageArchived && (
        <ArchivedDialog archived={archived} onClose={() => setManageArchived(false)} />
      )}
      {detailHabit !== null && (
        <HabitDetailDialog
          habit={detailHabit}
          entries={entries.filter((e) => e.habit === detailHabit.id)}
          streak={streakOf(detailHabit)}
          weekRate={weekRate(detailHabit)}
          onEdit={() => {
            setFormHabit(detailHabit);
            setDetailId(null);
          }}
          onClose={() => setDetailId(null)}
        />
      )}
      {logTarget !== null && (
        <LogValueDialog
          habit={logTarget.habit}
          day={logTarget.day}
          entry={entryMap.get(`${logTarget.habit.id}|${logTarget.day}`)}
          onSave={(value, note) => {
            void setEntry(logTarget.habit, logTarget.day, value, note);
            setLogTarget(null);
          }}
          onClose={() => setLogTarget(null)}
        />
      )}
    </div>
  );
}

function GroupRows({
  group,
  days,
  entryMap,
  streakOf,
  weekRate,
  onCellClick,
  onOpenDetail,
  onMoveHabit,
}: {
  group: { category: Category | null; habits: Habit[] };
  days: string[];
  entryMap: Map<string, Entry>;
  streakOf: (habit: Habit) => number;
  weekRate: (habit: Habit) => number;
  onCellClick: (habit: Habit, day: string) => void;
  onOpenDetail: (habit: Habit) => void;
  onMoveHabit: (habit: Habit, delta: number) => void;
}): React.JSX.Element {
  return (
    <>
      <tr>
        <td colSpan={days.length + 3} className="pt-4 pb-1">
          <span
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: group.category?.color ?? '#737373' }}
          >
            {group.category?.name ?? 'Other'}
          </span>
        </td>
      </tr>
      {group.habits.map((habit) => (
        <tr key={habit.id} className="group border-t">
          <td className="p-2">
            <span className="mr-1 inline-flex opacity-0 transition-opacity group-hover:opacity-60">
              <button
                type="button"
                title="Move up"
                className="px-0.5 text-xs hover:opacity-100"
                onClick={() => onMoveHabit(habit, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                title="Move down"
                className="px-0.5 text-xs hover:opacity-100"
                onClick={() => onMoveHabit(habit, 1)}
              >
                ↓
              </button>
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-2 text-left align-middle hover:underline"
              onClick={() => onOpenDetail(habit)}
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: habit.color || '#737373' }}
              />
              {habit.icon !== '' && <span>{habit.icon}</span>}
              <span>{habit.name}</span>
              {habit.type === 'quantity' && (
                <span className="text-xs opacity-50">
                  {targetOf(habit)} {habit.unit}
                </span>
              )}
            </button>
          </td>
          {days.map((day) => {
            const entry = entryMap.get(`${habit.id}|${day}`);
            const done = isDone(habit, entry);
            const partial = !done && entry !== undefined && entry.value > 0;
            return (
              <td key={day} className="p-1 text-center">
                <button
                  type="button"
                  title={entry?.note !== undefined && entry.note !== '' ? entry.note : undefined}
                  onClick={() => onCellClick(habit, day)}
                  className="h-7 w-7 rounded-md border text-xs tabular-nums transition-colors"
                  style={
                    done
                      ? {
                          backgroundColor: habit.color || '#10b981',
                          borderColor: 'transparent',
                          color: 'white',
                        }
                      : partial
                        ? { borderColor: habit.color || '#10b981', color: habit.color || 'inherit' }
                        : {}
                  }
                >
                  {habit.type === 'quantity' && entry !== undefined && entry.value > 0
                    ? entry.value
                    : done
                      ? '✓'
                      : ''}
                </button>
              </td>
            );
          })}
          <td className="p-1">
            <MiniHeatmap habit={habit} entryMap={entryMap} />
          </td>
          <td className="p-2 text-right text-xs tabular-nums opacity-70">
            🔥{streakOf(habit)} · {weekRate(habit)}%
          </td>
        </tr>
      ))}
    </>
  );
}

/* ------------------------- detail: heatmap + trend ------------------------- */

function HabitDetailDialog({
  habit,
  entries,
  streak,
  weekRate,
  onEdit,
  onClose,
}: {
  habit: Habit;
  entries: Entry[];
  streak: number;
  weekRate: number;
  onEdit: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const archive = async (): Promise<void> => {
    try {
      await getPbClient().call((pb) =>
        pb.collection('habits').update(habit.id, { archived: true }),
      );
      toast.success(`"${habit.name}" archived`);
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  const deleteHabit = async (): Promise<void> => {
    if (!window.confirm(`Delete "${habit.name}" and its entire history? This cannot be undone.`)) {
      return;
    }
    try {
      await getPbClient().call((pb) => pb.collection('habits').delete(habit.id));
      toast.success(`"${habit.name}" deleted`);
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  const clearHistory = async (): Promise<void> => {
    try {
      const res = await fetch('/api/ops/habits/clear-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ habit_id: habit.id }),
      });
      const data = (await res.json()) as { cleared?: number };
      toast.success(`Cleared ${data.cleared ?? 0} entries`);
    } catch {
      toast.error('Failed to clear history');
    }
  };

  const total = entries.length;
  const doneCount = entries.filter((e) => e.value >= targetOf(habit)).length;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`${habit.icon !== '' ? `${habit.icon} ` : ''}${habit.name}`}
      description={habit.description !== '' ? habit.description : undefined}
      className="max-w-2xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void archive()}>
              Archive
            </Button>
            <Button variant="outline" size="sm" onClick={() => void clearHistory()}>
              Clear history
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void deleteHabit()}>
              Delete
            </Button>
          </div>
          <Button size="sm" onClick={onEdit}>
            Edit habit
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-4 text-sm">
          <Badge>🔥 {streak} day streak</Badge>
          <Badge variant="secondary">{weekRate}% this week</Badge>
          <span className="opacity-60">
            {doneCount}/{total} logged days hit target
          </span>
        </div>
        <div>
          <p className="mb-1 text-xs opacity-70">Last 12 months</p>
          <YearHeatmap habit={habit} entries={entries} />
        </div>
        <div>
          <p className="mb-1 text-xs opacity-70">Last 60 days</p>
          <TrendChart habit={habit} entries={entries} />
        </div>
      </div>
    </Dialog>
  );
}

function YearHeatmap({ habit, entries }: { habit: Habit; entries: Entry[] }): React.JSX.Element {
  const byDay = useMemo(() => new Map(entries.map((e) => [e.day, e])), [entries]);
  const weeks = 52;
  const cell = 10;
  const gap = 2;
  const target = targetOf(habit);

  // Column per week, ending this week; rows Mon..Sun.
  const end = new Date();
  const endDow = (end.getDay() + 6) % 7; // 0 = Monday
  const cells: { day: string; ratio: number; note: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date();
      date.setDate(end.getDate() - ((weeks - 1 - w) * 7 + (endDow - d)));
      if (date > end) continue;
      const key = dayKey(date);
      const entry = byDay.get(key);
      cells.push({
        day: key,
        ratio: entry === undefined ? 0 : Math.min(1, entry.value / target),
        note: entry?.note ?? '',
      });
    }
  }

  const width = weeks * (cell + gap);
  const height = 7 * (cell + gap);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 110 }}>
      {cells.map((c, i) => {
        const w = Math.floor(i / 7);
        const d = i % 7;
        return (
          <rect
            key={c.day}
            x={w * (cell + gap)}
            y={d * (cell + gap)}
            width={cell}
            height={cell}
            rx={2}
            fill={c.ratio > 0 ? habit.color || '#10b981' : 'currentColor'}
            fillOpacity={c.ratio > 0 ? 0.25 + 0.75 * c.ratio : 0.08}
          >
            <title>
              {c.day}
              {c.note !== '' ? ` — ${c.note}` : ''}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

function TrendChart({ habit, entries }: { habit: Habit; entries: Entry[] }): React.JSX.Element {
  const byDay = useMemo(() => new Map(entries.map((e) => [e.day, e])), [entries]);
  const days = lastDays(60);
  const target = targetOf(habit);
  const values = days.map((day) => byDay.get(day)?.value ?? 0);
  const maxValue = Math.max(target, ...values, 1);

  const W2 = 600;
  const H2 = 90;
  const step = W2 / days.length;
  const y = (v: number): number => H2 - 8 - (v / maxValue) * (H2 - 20);

  return (
    <svg viewBox={`0 0 ${W2} ${H2}`} className="w-full" style={{ maxHeight: 100 }}>
      <line
        x1={0}
        x2={W2}
        y1={y(target)}
        y2={y(target)}
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeDasharray="4 4"
      />
      {values.map((v, i) => (
        <rect
          key={days[i]}
          x={i * step + 1}
          y={y(v)}
          width={Math.max(1, step - 2)}
          height={H2 - 8 - y(v)}
          fill={habit.color || '#10b981'}
          fillOpacity={v >= target ? 0.9 : 0.35}
        >
          <title>
            {days[i]}: {v}
          </title>
        </rect>
      ))}
    </svg>
  );
}

/* ----------------------------- habit form ----------------------------- */

function HabitFormDialog({
  habit,
  categories,
  onClose,
}: {
  habit?: Habit | undefined;
  categories: Category[];
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(habit?.name ?? '');
  const [description, setDescription] = useState(habit?.description ?? '');
  const [type, setType] = useState<'binary' | 'quantity'>(
    habit?.type === 'quantity' ? 'quantity' : 'binary',
  );
  const [target, setTarget] = useState(String(habit?.target ?? 1));
  const [unit, setUnit] = useState(habit?.unit ?? '');
  const [color, setColor] = useState(habit?.color ?? PALETTE[4]!);
  const [icon, setIcon] = useState(habit?.icon ?? '');
  const [category, setCategory] = useState(habit?.category ?? categories[0]?.id ?? '');

  const save = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const payload = {
      name: trimmed,
      description: description.trim(),
      type,
      target: type === 'quantity' ? Number(target) || 1 : 1,
      unit: type === 'quantity' ? unit.trim() : '',
      color,
      icon,
      category,
    };
    try {
      if (habit === undefined) {
        await getPbClient().call((pb) =>
          pb.collection('habits').create({ ...payload, order: Date.now() % 100000, archived: false }),
        );
        toast.success(`"${trimmed}" added`);
      } else {
        await getPbClient().call((pb) => pb.collection('habits').update(habit.id, payload));
      }
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={habit === undefined ? 'New habit' : 'Edit habit'}
      footer={
        <Button onClick={() => void save()} disabled={name.trim() === ''}>
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Input value={name} placeholder="Habit name" onChange={(e) => setName(e.target.value)} />
        <Input
          value={description}
          placeholder="Description (optional)"
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex items-center gap-2 text-sm">
          <label className="opacity-70">Type</label>
          <select
            className="rounded-md border bg-transparent px-2 py-1"
            value={type}
            onChange={(e) => setType(e.target.value === 'quantity' ? 'quantity' : 'binary')}
          >
            <option value="binary">Done / not done</option>
            <option value="quantity">Quantity vs target</option>
          </select>
          {type === 'quantity' && (
            <>
              <Input
                className="w-20"
                type="number"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
              <Input
                className="w-28"
                value={unit}
                placeholder="unit"
                onChange={(e) => setUnit(e.target.value)}
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="opacity-70">Category</label>
          <select
            className="rounded-md border bg-transparent px-2 py-1"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="">Other</option>
          </select>
          <label className="ml-2 opacity-70">Color</label>
          {PALETTE.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => setColor(swatch)}
              className={`h-5 w-5 rounded-full ${swatch === color ? 'ring-2 ring-offset-1' : ''}`}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <label className="mr-1 opacity-70">Icon</label>
          <button
            type="button"
            onClick={() => setIcon('')}
            className={`rounded-md border px-1.5 py-0.5 text-xs ${icon === '' ? 'ring-2' : 'opacity-60'}`}
          >
            none
          </button>
          {ICONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setIcon(emoji)}
              className={`rounded-md px-1 ${icon === emoji ? 'ring-2' : ''}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/* --------------------------- category manager --------------------------- */

function CategoryManagerDialog({
  categories,
  onClose,
}: {
  categories: Category[];
  onClose: () => void;
}): React.JSX.Element {
  const [newName, setNewName] = useState('');

  const add = async (): Promise<void> => {
    const trimmed = newName.trim();
    if (trimmed === '') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('categories').create({
          name: trimmed,
          color: PALETTE[categories.length % PALETTE.length],
          order: Math.max(0, ...categories.map((c) => c.order + 1)),
        }),
      );
      setNewName('');
    } catch {
      /* surfaced by shell */
    }
  };

  const update = async (category: Category, patch: Record<string, unknown>): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('categories').update(category.id, patch));
    } catch {
      /* surfaced by shell */
    }
  };

  const remove = async (category: Category): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('categories').delete(category.id));
      toast.success(`"${category.name}" deleted — its habits moved to Other`);
    } catch {
      /* surfaced by shell */
    }
  };

  const move = async (index: number, delta: number): Promise<void> => {
    const other = categories[index + delta];
    const current = categories[index];
    if (other === undefined || current === undefined) return;
    await update(current, { order: other.order });
    await update(other, { order: current.order });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Manage categories"
    >
      <div className="flex flex-col gap-2">
        {categories.map((category, index) => (
          <div key={category.id} className="flex items-center gap-2 text-sm">
            <Input
              className="w-40"
              defaultValue={category.name}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value !== '' && value !== category.name) void update(category, { name: value });
              }}
            />
            {PALETTE.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => void update(category, { color: swatch })}
                className={`h-4 w-4 rounded-full ${category.color === swatch ? 'ring-2 ring-offset-1' : ''}`}
                style={{ backgroundColor: swatch }}
              />
            ))}
            <button type="button" className="opacity-60 hover:opacity-100" onClick={() => void move(index, -1)}>
              ↑
            </button>
            <button type="button" className="opacity-60 hover:opacity-100" onClick={() => void move(index, 1)}>
              ↓
            </button>
            <button
              type="button"
              className="ml-auto text-xs opacity-50 hover:opacity-100"
              onClick={() => void remove(category)}
            >
              ✕
            </button>
          </div>
        ))}
        <Input
          value={newName}
          placeholder="+ New category (Enter)"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
      </div>
    </Dialog>
  );
}

/* ----------------------------- value logger ----------------------------- */

function LogValueDialog({
  habit,
  day,
  entry,
  onSave,
  onClose,
}: {
  habit: Habit;
  day: string;
  entry: Entry | undefined;
  onSave: (value: number, note: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(String(entry !== undefined && entry.value > 0 ? entry.value : ''));
  const [note, setNote] = useState(entry?.note ?? '');

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`${habit.name} — ${day}`}
      description={`Target: ${targetOf(habit)} ${habit.unit}`.trim()}
      footer={<Button onClick={() => onSave(Number(value) || 0, note.trim())}>Save</Button>}
    >
      <div className="flex flex-col gap-2">
        <Input
          type="number"
          value={value}
          placeholder="0"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(Number(value) || 0, note.trim());
          }}
          autoFocus
        />
        <Input value={note} placeholder="Note (optional)" onChange={(e) => setNote(e.target.value)} />
      </div>
    </Dialog>
  );
}

/* --------------------------- archived habits --------------------------- */

function ArchivedDialog({
  archived,
  onClose,
}: {
  archived: Habit[];
  onClose: () => void;
}): React.JSX.Element {
  const unarchive = async (habit: Habit): Promise<void> => {
    try {
      await getPbClient().call((pb) =>
        pb.collection('habits').update(habit.id, { archived: false }),
      );
      toast.success(`"${habit.name}" restored`);
    } catch {
      /* surfaced by shell */
    }
  };

  const remove = async (habit: Habit): Promise<void> => {
    if (!window.confirm(`Delete "${habit.name}" and its history permanently?`)) return;
    try {
      await getPbClient().call((pb) => pb.collection('habits').delete(habit.id));
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Archived habits"
      description="Restore a habit to the grid (its history is intact) or delete it for good."
    >
      <div className="flex flex-col gap-2">
        {archived.map((habit) => (
          <div key={habit.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: habit.color || '#737373' }}
            />
            {habit.icon !== '' && <span>{habit.icon}</span>}
            <span className="flex-1">{habit.name}</span>
            <Button variant="outline" size="sm" onClick={() => void unarchive(habit)}>
              Restore
            </Button>
            <button
              type="button"
              className="text-xs opacity-50 hover:opacity-100"
              onClick={() => void remove(habit)}
            >
              ✕
            </button>
          </div>
        ))}
        {archived.length === 0 && <p className="text-sm opacity-60">Nothing archived.</p>}
      </div>
    </Dialog>
  );
}

/** Compact 5-week heatmap shown inline on each habit row. */
function MiniHeatmap({
  habit,
  entryMap,
}: {
  habit: Habit;
  entryMap: Map<string, Entry>;
}): React.JSX.Element {
  const weeks = 5;
  const cell = 6;
  const gap = 1.5;
  const target = targetOf(habit);
  const end = new Date();
  const endDow = (end.getDay() + 6) % 7;

  const cells: { key: string; ratio: number }[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date();
      date.setDate(end.getDate() - ((weeks - 1 - w) * 7 + (endDow - d)));
      if (date > end) continue;
      const key = dayKey(date);
      const entry = entryMap.get(`${habit.id}|${key}`);
      cells.push({ key, ratio: entry === undefined ? 0 : Math.min(1, entry.value / target) });
    }
  }

  const width = weeks * (cell + gap);
  const height = 7 * (cell + gap);
  return (
    <svg width={width} height={height} className="mx-auto block" aria-label="last 5 weeks">
      {cells.map((c, i) => (
        <rect
          key={c.key}
          x={Math.floor(i / 7) * (cell + gap)}
          y={(i % 7) * (cell + gap)}
          width={cell}
          height={cell}
          rx={1.5}
          fill={c.ratio > 0 ? habit.color || '#10b981' : 'currentColor'}
          fillOpacity={c.ratio > 0 ? 0.3 + 0.7 * c.ratio : 0.08}
        >
          <title>{c.key}</title>
        </rect>
      ))}
    </svg>
  );
}
