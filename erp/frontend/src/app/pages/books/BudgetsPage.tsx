/**
 * Budgets: what you plan to earn and spend per account and month for a
 * year, against what really happened. Type into the grid (or spread a
 * yearly amount evenly over the months) and save; the chart compares the
 * plan with the books month by month.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Divide, PiggyBank, Save } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { monthShort } from '../../components/books/period.ts';
import { PairBars, PairLegend } from '../../components/charts.tsx';
import { Segmented } from '../../components/controls.tsx';
import { toMinor } from '../../components/money/RecordPayment.tsx';
import { Card, CardHeader, CircleButton, Empty, Figure, LoadError, PageHeader, PageSkeleton, PillButton, Popover, cellInput, softInput } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { monthLabel, today } from '../../lib/dates.ts';
import { compact, decimalsOf, minorToText, money, normalizeNumber, qty } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { baseCurrency, can, useMe } from '../../lib/me.ts';
import { replaceQuery } from '../../lib/router.ts';
import type { Account, AccountList, BudgetReport, BudgetRow } from '../../lib/types/books.ts';
import type { PageProps } from '../../routes.tsx';

interface Row {
  id: string;
  code: string;
  name: string;
  type: 'income' | 'expense';
  budget: number[];
  actual: number[];
}

function fiscalYearOf(day: string, fm: number): number {
  const y = Number(day.slice(0, 4));
  return Number(day.slice(5, 7)) >= fm ? y : y - 1;
}

export function BudgetsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const cur = baseCurrency(me);
  const fm = me.company.fiscal_start_month >= 1 ? me.company.fiscal_start_month : 1;
  const yearQ = Number(query.get('year'));
  const year = Number.isFinite(yearQ) && yearQ > 1970 ? yearQ : fiscalYearOf(today(), fm);
  const [side, setSide] = useState<'income' | 'expense'>('expense');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [tableRef, fits] = useFits();
  const canEdit = can(me, 'accounting', 'edit');

  const data = useLive(
    async () => {
      const [b, accs] = await Promise.all([op<BudgetReport>('budgets.get', { year }, { quiet: true }), op<AccountList>('accounts.list', { balances: false }, { quiet: true })]);
      return { b, accs: accs.accounts };
    },
    [...READS.books, 'budgets'],
    [year],
  );

  const rows = useMemo((): Row[] => {
    if (data.data === null) return [];
    const byId = new Map<string, BudgetRow>(data.data.b.accounts.map((r) => [r.id, r]));
    const zero = data.data.b.months.map(() => 0);
    return data.data.accs
      .filter((a: Account) => (a.type === 'income' || a.type === 'expense') && !a.archived)
      .map((a) => {
        const r = byId.get(a.id);
        return { id: a.id, code: a.code, name: a.name, type: a.type as 'income' | 'expense', budget: r?.budget ?? zero, actual: r?.actual ?? zero };
      });
  }, [data.data]);

  if (data.error !== null && data.data === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (data.data === null) return <PageSkeleton rows={10} />;

  const months = data.data.b.months;
  const key = (acc: string, m: string): string => `${acc}|${m}`;
  const cell = (r: Row, i: number): number => {
    const m = months[i] ?? '';
    const e = edits[key(r.id, m)];
    if (e !== undefined) return e === '' ? 0 : (toMinor(e, cur) ?? 0);
    return r.budget[i] ?? 0;
  };
  const dirty = Object.keys(edits).length;
  const shown = rows.filter((r) => r.type === side);
  const sumBy = (list: Row[], f: (r: Row, i: number) => number): number[] => months.map((_, i) => list.reduce((s, r) => s + f(r, i), 0));
  const budgetM = sumBy(shown, cell);
  const actualM = sumBy(shown, (r, i) => r.actual[i] ?? 0);
  const thisMonth = today().slice(0, 7);
  const sofar = months.map((m) => m <= thisMonth);
  const budgetToDate = budgetM.reduce((s, v, i) => s + (sofar[i] === true ? v : 0), 0);
  const actualToDate = actualM.reduce((s, v) => s + v, 0);
  const variance = side === 'income' ? actualToDate - budgetToDate : budgetToDate - actualToDate;
  const yearLabel = fm === 1 ? String(year) : `${year} to ${year + 1}`;
  const setYear = (y: number): void => {
    setEdits({});
    replaceQuery('budgets', { year: String(y) });
  };

  const save = async (): Promise<void> => {
    const lines = Object.entries(edits).map(([k, v]) => {
      const [account = '', month = ''] = k.split('|');
      return { account, month, amount: v === '' ? '0' : (normalizeNumber(v, decimalsOf(cur)) ?? '0') };
    });
    setSaving(true);
    try {
      await op('budgets.set', { lines });
      toast.success('Budget saved');
      setEdits({});
      data.reload();
    } catch {
      /* shown */
    } finally {
      setSaving(false);
    }
  };

  const groups: { type: 'income' | 'expense'; label: string; rows: Row[] }[] = [
    { type: 'income', label: 'Money earned', rows: rows.filter((r) => r.type === 'income') },
    { type: 'expense', label: 'Money spent', rows: rows.filter((r) => r.type === 'expense') },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Budgets"
        subtitle="What you plan to earn and spend each month, against what really happened"
        actions={
          <>
            <div className="inline-flex h-11 items-center gap-1 rounded-full bg-[var(--erp-card)] p-1" role="group" aria-label="Year">
              <CircleButton icon={ChevronLeft} label="Previous year" variant="ghost" size={36} onClick={() => setYear(year - 1)} />
              <span className="num min-w-[6rem] text-center text-[14px] font-bold">{yearLabel}</span>
              <CircleButton icon={ChevronRight} label="Next year" variant="ghost" size={36} onClick={() => setYear(year + 1)} />
            </div>
            {canEdit && dirty > 0 && (
              <>
                <PillButton variant="light" onClick={() => setEdits({})}>
                  Undo changes
                </PillButton>
                <PillButton icon={Save} dot loading={saving} onClick={() => void save()}>
                  Save {dirty} {dirty === 1 ? 'change' : 'changes'}
                </PillButton>
              </>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card className="@min-[900px]:col-span-8" delay={1}>
          <CardHeader
            title={side === 'income' ? 'Earned against plan' : 'Spent against plan'}
            subtitle="Each month of the year"
            action={
              <Segmented
                ariaLabel="Income or spending"
                value={side}
                onChange={setSide}
                options={[
                  { value: 'expense', label: 'Spending' },
                  { value: 'income', label: 'Income' },
                ]}
              />
            }
          />
          <PairBars
            height={170}
            aName="Plan"
            bName="Actual"
            points={months.map((m, i) => ({
              key: m,
              label: monthLabel(m),
              axis: monthShort(m),
              a: (budgetM[i] ?? 0) / 10 ** decimalsOf(cur),
              b: Math.max(0, actualM[i] ?? 0) / 10 ** decimalsOf(cur),
              aText: money(budgetM[i] ?? 0, cur),
              bText: money(actualM[i] ?? 0, cur),
            }))}
          />
          <div className="mt-3">
            <PairLegend a="Plan" b="Actual" />
          </div>
        </Card>
        <Card tone="sand" className="@min-[900px]:col-span-4" delay={2}>
          <Figure label={side === 'income' ? 'Earned so far this year' : 'Spent so far this year'} value={money(actualToDate, cur)} sub={`Plan to date ${money(budgetToDate, cur)}`} />
          <div className="mt-4 rounded-[18px] bg-[var(--erp-card)] p-3">
            <span className="block text-[12px] text-[var(--erp-muted)]">{variance >= 0 ? (side === 'income' ? 'Ahead of plan' : 'Under plan') : side === 'income' ? 'Behind plan' : 'Over plan'}</span>
            <span className={cn('num block text-[15px] font-bold', variance >= 0 ? 'text-[var(--erp-green-text)]' : 'text-[var(--erp-red-text)]')}>{money(Math.abs(variance), cur)}</span>
          </div>
          <div className="mt-2 rounded-[18px] bg-[var(--erp-card)] p-3">
            <span className="block text-[12px] text-[var(--erp-muted)]">Plan for the whole year</span>
            <span className="num block text-[15px] font-bold">{money(budgetM.reduce((s, v) => s + v, 0), cur)}</span>
          </div>
        </Card>
      </div>

      <Card padded={false} delay={2}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 @min-[640px]:px-6">
          <div>
            <h2 className="text-[15px] font-bold">Plan by account</h2>
            <p className="text-[13px] text-[var(--erp-muted)]">{`${yearLabel}, in ${cur}`}</p>
          </div>
        </div>
        {rows.length === 0 ? (
          <Empty icon={PiggyBank} title="No income or expense accounts">
            Add accounts to the chart first.
          </Empty>
        ) : (
          // All twelve months fit beside the sidebar on a laptop; narrower screens scroll sideways under the frozen account column.
          <div className="mt-4 relative overflow-x-auto px-2 pb-4 @min-[640px]:px-3">
            <table ref={tableRef} className="w-full min-w-[920px] table-fixed border-separate border-spacing-y-1 text-[13px]">
              <colgroup>
                <col className="w-[208px]" />
                <col className="w-[96px]" />
                {months.map((m) => (
                  <col key={m} />
                ))}
              </colgroup>
              <thead>
                <tr className="text-[12px] text-[var(--erp-muted)]">
                  <th className="sticky left-0 z-10 bg-[var(--erp-card)] px-3 pb-1 text-left font-semibold">Account</th>
                  <th className="px-2 pb-1 text-right font-semibold leading-4">
                    <span className="block">Year plan</span>
                    <span className="block font-medium">Actual</span>
                  </th>
                  {months.map((m) => (
                    <th key={m} className={cn('px-2 pb-1 text-right align-bottom font-semibold', m === thisMonth && 'text-[var(--erp-ink)]')}>
                      {monthShort(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              {groups.map((g) =>
                g.rows.length === 0 ? null : (
                  <tbody key={g.type}>
                    <tr>
                      <td className="sticky left-0 z-10 bg-[var(--erp-card)] px-3 pb-1 pt-3 text-[12px] font-bold text-[var(--erp-muted)]">{g.label}</td>
                      <td colSpan={months.length + 1} />
                    </tr>
                    {g.rows.map((r) => {
                      const total = months.reduce((s2, _, i) => s2 + cell(r, i), 0);
                      const actual = r.actual.reduce((s2, v) => s2 + v, 0);
                      const over = r.type === 'expense' ? actual > total && total > 0 : false;
                      return (
                        <tr key={r.id}>
                          <td className="sticky left-0 z-10 bg-[var(--erp-card)] py-0.5 pl-3 pr-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="num shrink-0 text-[12px] font-bold text-[var(--erp-muted)]">{r.code}</span>
                              <span className="min-w-0 flex-1 truncate font-semibold" title={r.name}>
                                {r.name}
                              </span>
                              {canEdit && <Spread row={r} year={year} cur={cur} onDone={data.reload} />}
                            </span>
                          </td>
                          <td className="num truncate px-2 py-0.5 text-right leading-4">
                            <span className="block truncate font-bold">{total !== 0 ? money(total, cur, 'compact') : ''}</span>
                            <span className={cn('block truncate text-[12px] text-[var(--erp-muted)]', over && 'font-bold text-[var(--erp-red-text)]')}>{actual !== 0 ? money(actual, cur, 'compact') : ''}</span>
                          </td>
                          {months.map((m, i) => {
                            const k = key(r.id, m);
                            const e = edits[k];
                            const v = e !== undefined ? e : (r.budget[i] ?? 0) !== 0 ? planText(r.budget[i] ?? 0, cur) : '';
                            const bad = e !== undefined && e !== '' && toMinor(e, cur) === null;
                            // Too long for the cell: the short form until the cell is being typed in.
                            const shown = focusKey === k || bad || fits(v) ? v : shortPlan(cell(r, i), cur);
                            return (
                              <td key={m} className="px-0.5 py-0.5">
                                {canEdit ? (
                                  <input
                                    value={shown}
                                    onFocus={() => setFocusKey(k)}
                                    onBlur={() => setFocusKey((f) => (f === k ? null : f))}
                                    onChange={(ev) => setEdits({ ...edits, [k]: ev.target.value })}
                                    inputMode="decimal"
                                    aria-label={`${r.name}, ${monthLabel(m)}`}
                                    title={v !== '' ? v : undefined}
                                    placeholder="0"
                                    className={cn(cellInput, 'num h-9 rounded-[10px] px-1 text-right text-[13px]', e !== undefined && 'bg-[var(--erp-accent-soft)]', bad && 'ring-2 ring-[var(--erp-red)]')}
                                  />
                                ) : (
                                  <span className="num block truncate px-1 text-right">{(r.budget[i] ?? 0) !== 0 ? money(r.budget[i] ?? 0, cur, 'compact') : ''}</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                ),
              )}
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** A month's plan as typed: "12,500", with cents only when there are some (it fits a narrow cell). */
function planText(minor: number, cur: string): string {
  const d = decimalsOf(cur);
  const t = minorToText(minor, cur);
  const [whole = '', frac = ''] = (minor % 10 ** d === 0 && d > 0 ? t.slice(0, -(d + 1)) : t).split('.');
  const neg = whole.startsWith('-');
  const grouped = (neg ? whole.slice(1) : whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac !== '' ? `.${frac}` : ''}`;
}

/** A month's plan in short form for a narrow cell: "12.5K", or whole units below ten thousand. */
function shortPlan(minor: number, cur: string): string {
  const major = minor / 10 ** decimalsOf(cur);
  return Math.abs(major) >= 10000 ? compact(major) : qty(Math.round(major));
}

/**
 * Whether a text fits a month cell of the grid. Digits are tabular, so a
 * text's width is the sum of its characters' widths, measured once per cell
 * size from the cells' own font.
 */
function useFits(): [(el: HTMLTableElement | null) => void, (text: string) => boolean] {
  const [m, setM] = useState<{ room: number; w: Record<string, number> } | null>(null);
  const watch = useRef<ResizeObserver | null>(null);
  const ref = useCallback((table: HTMLTableElement | null) => {
    watch.current?.disconnect();
    if (table === null) return;
    const measure = (): void => {
      const input = table.querySelector('tbody input');
      if (!(input instanceof HTMLInputElement)) return;
      const cs = getComputedStyle(input);
      const probe = document.createElement('span');
      Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre', fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontVariantNumeric: cs.fontVariantNumeric, letterSpacing: cs.letterSpacing });
      document.body.appendChild(probe);
      const w: Record<string, number> = {};
      for (const ch of ['0', ',', '.', '-', '−']) {
        probe.textContent = ch.repeat(10);
        w[ch] = probe.getBoundingClientRect().width / 10;
      }
      probe.remove();
      const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setM((old) => (old !== null && Math.abs(old.room - room) < 0.5 ? old : { room, w }));
    };
    measure();
    watch.current = new ResizeObserver(measure);
    watch.current.observe(table);
  }, []);
  const fits = (text: string): boolean => m === null || [...text].reduce((sum, ch) => sum + (m.w[ch] ?? m.w['0'] ?? 8), 0) <= m.room;
  return [ref, fits];
}

/** Spread a yearly amount evenly over the 12 months of one account. */
function Spread({ row, year, cur, onDone }: { row: Row; year: number; cur: string; onDone: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    const n = normalizeNumber(text, decimalsOf(cur));
    if (n === null) return;
    setBusy(true);
    try {
      await op('budgets.set', { account: row.id, year, annual: n });
      toast.success(`${row.name}: spread over 12 months`);
      setOpen(false);
      setText('');
      onDone();
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative">
      <CircleButton icon={Divide} label={`Spread a yearly amount for ${row.name}`} variant="ghost" size={28} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={() => setOpen(false)} align="left" className="w-72 p-4">
        <p className="mb-2 text-[13px] font-bold">Spread over the year</p>
        <p className="mb-3 text-[12px] text-[var(--erp-muted)]">The amount for the whole year, split evenly into 12 months.</p>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
          }}
          inputMode="decimal"
          placeholder="60000"
          aria-label="Yearly amount"
          className={cn(softInput, 'num')}
          autoFocus
        />
        <PillButton size="sm" className="mt-3 w-full" loading={busy} disabled={normalizeNumber(text, decimalsOf(cur)) === null} onClick={() => void run()}>
          Spread it
        </PillButton>
      </Popover>
    </div>
  );
}
