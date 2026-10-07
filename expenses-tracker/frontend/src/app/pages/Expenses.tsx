/**
 * Every expense, a month at a time, grouped by day. Search looks across all
 * months. Select turns on bulk changes (move to a category, delete).
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Plus, Search, Wallet, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { AskAgent } from '../components/AskAgent.tsx';
import { useEntry } from '../components/Entry.tsx';
import { ExpenseRow } from '../components/ExpenseRow.tsx';
import { Card, Empty, MonthSwitcher, PageHeader, PillButton, PillSelect, TextLink, pillInput, useConfirm } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { dayLabel, monthLabel, thisMonth } from '../lib/dates.ts';
import { useLive } from '../lib/live.ts';
import { money } from '../lib/money.ts';
import type { Expense } from '../lib/types.ts';

export function ExpensesPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const { currency, categories } = useApp();
  const entry = useEntry();
  const [month, setMonth] = useState(query.get('month') ?? thisMonth());
  const [category, setCategory] = useState(query.get('category') ?? '');
  const [text, setText] = useState(query.get('q') ?? '');
  const [q, setQ] = useState(query.get('q') ?? '');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusDay, setFocusDay] = useState<string | null>(query.get('day'));
  const [confirmEl, confirm] = useConfirm();

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const searching = q !== '';
  const list = useLive(
    () =>
      api.list({
        ...(searching ? { q, limit: 500 } : { month, limit: 2000 }),
        ...(category === 'none' ? { uncategorized: true } : category !== '' ? { category } : {}),
      }),
    ['expenses', 'categories'],
    [month, category, q],
  );
  const expenses = list.data?.expenses ?? [];

  const groups = useMemo(() => {
    const out: { day: string; total: number; items: Expense[] }[] = [];
    for (const e of expenses) {
      const last = out[out.length - 1];
      if (last !== undefined && last.day === e.date) {
        last.items.push(e);
        last.total += e.amount_minor;
      } else out.push({ day: e.date, total: e.amount_minor, items: [e] });
    }
    return out;
  }, [expenses]);

  const uncategorized = !searching && category === '' ? expenses.filter((e) => e.category_id === null).length : 0;

  useEffect(() => {
    if (focusDay === null || list.data === null) return;
    document.getElementById(`day-${focusDay}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(() => setFocusDay(null), 2600);
    return () => clearTimeout(t);
  }, [focusDay, list.data]);

  const toggle = (id: string): void =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const stop = (): void => {
    setSelecting(false);
    setSelected(new Set());
  };
  const moveTo = async (cat: string): Promise<void> => {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      await api.setCategory(ids, cat === 'none' ? '' : cat);
      toast.success(`${ids.length} moved`);
      stop();
    } catch {
      /* toasted */
    }
  };
  const removeSelected = async (): Promise<void> => {
    const ids = [...selected];
    if (!(await confirm(`${ids.length} ${ids.length === 1 ? 'expense is' : 'expenses are'} deleted, with their receipts.`, 'Delete selected?'))) return;
    try {
      await api.removeMany(ids);
      toast.success(`${ids.length} deleted`);
      stop();
    } catch {
      /* toasted */
    }
  };

  const categoryOptions = [
    { value: '', label: 'All categories' },
    { value: 'none', label: 'Uncategorized' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle={
          list.data !== null ? (
            <span className="num">
              {list.data.count} {list.data.count === 1 ? 'expense' : 'expenses'} · {money(list.data.total_minor, currency)}
              {searching ? ' across all months' : ` in ${monthLabel(month)}`}
            </span>
          ) : (
            ' '
          )
        }
        actions={
          <>
            {expenses.length > 0 && !selecting && (
              <PillButton variant="light" icon={CheckSquare} onClick={() => setSelecting(true)}>
                Select
              </PillButton>
            )}
            <PillButton variant="dark" icon={Plus} dot onClick={(e) => entry.add(e.currentTarget)}>
              Add expense
            </PillButton>
          </>
        }
      />

      <div className="et-rise et-d1 mb-5 flex flex-wrap items-center gap-3">
        {!searching && <MonthSwitcher month={month} onChange={setMonth} />}
        <label className="relative min-w-[14rem] flex-1">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--et-muted)]" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search every month" aria-label="Search expenses" className={cn(pillInput, 'pl-11 pr-11')} />
          {text !== '' && (
            <button type="button" onClick={() => setText('')} aria-label="Clear search" className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full hover:bg-[var(--et-row)]">
              <X size={14} />
            </button>
          )}
        </label>
        <PillSelect ariaLabel="Category" value={category} onChange={setCategory} options={categoryOptions} className="w-full sm:w-56" />
      </div>

      {uncategorized > 0 && (
        <Card tone="sand" className="mb-5 flex flex-wrap items-center justify-between gap-3 !py-4">
          <div>
            <p className="text-[14px] font-bold">
              {uncategorized} {uncategorized === 1 ? 'expense has' : 'expenses have'} no category
            </p>
            <TextLink tone="muted" onClick={() => setCategory('none')}>
              Show them
            </TextLink>
          </div>
          <AskAgent trigger="categorize_requested" label="Ask your AI agent to sort them" />
        </Card>
      )}

      {list.data !== null && expenses.length === 0 ? (
        <Card>
          <Empty
            icon={Wallet}
            title={searching ? `Nothing matches "${q}"` : `No expenses in ${monthLabel(month)}`}
            action={
              searching ? undefined : (
                <PillButton variant="dark" icon={Plus} dot onClick={(e) => entry.add(e.currentTarget)}>
                  Add expense
                </PillButton>
              )
            }
          >
            {searching ? 'Search looks at what each expense was for.' : category !== '' ? 'Try another category.' : undefined}
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g, i) => (
            <Card key={g.day} className={cn('!p-4 transition-shadow', focusDay === g.day && 'ring-2 ring-[var(--et-accent)]')} delay={Math.min(i + 1, 5)}>
              <div id={`day-${g.day}`} className="mb-3 flex items-center justify-between px-1">
                <span className="text-[14px] font-bold">{dayLabel(g.day)}</span>
                <span className="num text-[13px] font-semibold text-[var(--et-ink-2)]">{money(g.total, currency)}</span>
              </div>
              <div className="flex flex-col gap-2">
                {g.items.map((e) => (
                  <ExpenseRow
                    key={e.id}
                    e={e}
                    currency={currency}
                    showDate={false}
                    onOpen={(el, x) => entry.edit(el, x)}
                    selectable={selecting}
                    selected={selected.has(e.id)}
                    onToggle={toggle}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {selecting && (
        <div className="et-pop et-on-ink fixed bottom-24 left-1/2 z-40 flex w-[min(94vw,40rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-full bg-[var(--et-ink)] p-2 pl-5 text-[var(--et-shell)] shadow-2xl md:bottom-8">
          <span className="mr-auto text-[14px] font-bold">{selected.size} selected</span>
          <PillSelect
            ariaLabel="Move selected to category"
            value=""
            onChange={(v) => v !== '' && void moveTo(v)}
            options={[{ value: '', label: 'Move to' }, { value: 'none', label: 'Uncategorized' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
            className="w-44"
          />
          <PillButton variant="danger" disabled={selected.size === 0} onClick={() => void removeSelected()}>
            Delete
          </PillButton>
          <PillButton variant="accent" onClick={stop}>
            Done
          </PillButton>
        </div>
      )}
      {confirmEl}
    </div>
  );
}
