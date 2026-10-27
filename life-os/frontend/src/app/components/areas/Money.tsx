/**
 * Money: the month in a jar (what is left of the budget, per day), a quick
 * spend by drawing, where it went, the jars you save into and the bills
 * that come every month.
 */
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { useStatus } from '../../lib/context.tsx';
import { MONTHS, parseDay, relDay } from '../../lib/format.ts';
import { act, changed, drop, insert, localDay, patch, patchWhere, tempId, useLive } from '../../lib/live.ts';
import type { Change } from '../../lib/live.ts';
import { enter, rowOf, vanish } from '../../lib/motion.ts';
import type { Bill, MoneyEntry, MoneyMonth, Pot } from '../../lib/types.ts';
import { AreaArt, CategoryArt, INCOME_CATEGORIES, Jar, SPEND_CATEGORIES } from '../art.tsx';
import { ThingArt } from '../art2.tsx';
import { Chip, Meter } from '../bits.tsx';
import { Panel } from '../panel.tsx';
import { Bars } from '../charts.tsx';
import { useMoney } from '../goals.tsx';
import { snack } from '../snack.tsx';
import { Button, Skeleton } from '../ui.tsx';

const READS = ['money_entries', 'money_pots', 'bills', 'settings', 'goals'] as const;

function moneyChanged(): void {
  changed('money_entries', 'money_pots', 'bills', 'goals', 'settings');
}

const MONEY_READS = ['money_entries', 'money_pots', 'bills', 'goals', 'settings'] as const;

/** The month's numbers after a spend or income (minor units), on every summary that shows them. */
function moved(kind: 'spend' | 'income', amount: string, category: string, sign = 1): Change {
  return patchWhere(
    (o) => typeof o.spent === 'number' && Array.isArray(o.by_category) && 'budget' in o,
    (o) => {
      const minor = Math.round(Number(amount) * 10 ** Number(o.digits ?? 2)) * sign;
      if (!Number.isFinite(minor)) return {};
      if (kind === 'income') return typeof o.income === 'number' ? { income: o.income + minor } : {};
      const cats = o.by_category as { category: string; amount: number }[];
      const has = cats.some((c) => c.category === category);
      return {
        spent: Number(o.spent) + minor,
        left: o.left === null || o.left === undefined ? o.left : Number(o.left) - minor,
        by_category: (has ? cats.map((c) => (c.category === category ? { ...c, amount: c.amount + minor } : c)) : [...cats, { category, amount: minor }]).filter((c) => c.amount > 0).sort((x, y) => y.amount - x.amount),
      };
    },
  );
}

const field = 'h-10 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[14px] font-semibold outline-none focus:border-[var(--lo-accent)]';

function SpendPad(): React.JSX.Element {
  const s = useStatus().data;
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<'spend' | 'income'>('spend');
  const save = async (category: string): Promise<void> => {
    const a = amount.trim();
    const n = note.trim();
    if (a === '') return;
    setAmount('');
    setNote('');
    snack(kind === 'spend' ? `Spent ${a}` : `Got ${a}`);
    const digits = s?.digits ?? 2;
    const draft = { id: tempId(), amount: Math.round(Number(a) * 10 ** digits), category, kind, note: n, date: localDay(), actor: 'person' } as unknown as MoneyEntry;
    const r = await act([moved(kind, a, category), insert((k) => k === 'entries', draft, 'start')], () => op('money.add', { amount: a, category, kind, note: n }), [...MONEY_READS]);
    if (r === undefined) {
      setAmount(a);
      setNote(n);
    }
  };
  const cats = kind === 'spend' ? SPEND_CATEGORIES : INCOME_CATEGORIES;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <Chip active={kind === 'spend'} onClick={() => setKind('spend')}>
            Spent
          </Chip>
          <Chip active={kind === 'income'} onClick={() => setKind('income')}>
            Got
          </Chip>
        </div>
        <span className="text-[13px] font-bold text-[var(--lo-muted)]">{s?.currency}</span>
        <input autoFocus={false} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Amount" className={cn(field, 'num w-32 text-[15px] font-extrabold')} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What for (optional)" aria-label="Note" maxLength={120} className={cn(field, 'min-w-0 flex-1')} />
      </div>
      <div className={cn('mt-3 flex flex-wrap gap-1.5 transition-opacity', amount.trim() === '' && 'opacity-45')}>
        {cats.map((c) => (
          <button key={c.key} type="button" disabled={amount.trim() === ''} onClick={() => void save(c.key)} className="flex w-[86px] flex-col items-center gap-1 rounded-[var(--lo-r)] border border-[var(--lo-hair)] py-2 text-[12px] font-bold transition-transform hover:-translate-y-0.5 hover:border-[var(--lo-line)] disabled:hover:translate-y-0">
            <CategoryArt category={c.key} size={36} />
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PotCard({ pot }: { pot: Pot }): React.JSX.Element {
  const fmt = useMoney();
  const [v, setV] = useState('');
  const digits = useStatus().data?.digits ?? 2;
  const add = async (take: boolean): Promise<void> => {
    const a = v.trim();
    if (a === '') return;
    setV('');
    snack(take ? `Took ${a} out of ${pot.name}` : `Put ${a} into ${pot.name}`);
    const minor = Math.round(Number(a) * 10 ** digits) * (take ? -1 : 1);
    const r = await act([patch<Pot>(pot.id, (x) => ({ saved: Math.max(0, x.saved + (Number.isFinite(minor) ? minor : 0)) }))], () => op('pots.add', { pot: pot.id, amount: a, take }), [...MONEY_READS]);
    if (r === undefined) setV(a);
  };
  return (
    <div className="flex w-[180px] flex-col items-center text-center">
      <Jar fill={pot.target > 0 ? pot.saved / pot.target : 0} size={96} label={`${pot.name}: ${fmt(pot.saved)}`} />
      <p className="mt-1 truncate text-[14px] font-bold">{pot.name}</p>
      <p className="num text-[13px] font-semibold text-[var(--lo-ink-2)]">
        {fmt(pot.saved, { whole: true })} {pot.target > 0 ? `of ${fmt(pot.target, { whole: true })}` : ''}
      </p>
      <div className="mt-2 flex w-full gap-1">
        <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add(false)} inputMode="decimal" placeholder="Amount" aria-label={`Amount for ${pot.name}`} className="num h-8 min-w-0 flex-1 rounded-[var(--lo-r-sm)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-2 text-[13px] font-bold outline-none focus:border-[var(--lo-accent)]" />
        <button type="button" disabled={v.trim() === ''} onClick={() => void add(false)} className="h-8 rounded-[var(--lo-r-sm)] bg-[var(--lo-primary)] px-2 text-[12px] font-extrabold text-white disabled:opacity-40">
          Put in
        </button>
      </div>
    </div>
  );
}

function NewPot(): React.JSX.Element {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const add = async (): Promise<void> => {
    if (name.trim() === '') return;
    await op('pots.create', { name: name.trim(), target: target.trim() === '' ? '0' : target.trim(), look: Math.floor(Math.random() * 8) });
    moneyChanged();
    snack(`A new jar: ${name.trim()}`);
    setName('');
    setTarget('');
  };
  return (
    <div className="flex w-[200px] flex-col items-center justify-center gap-2 rounded-[var(--lo-r-xl)] border border-dashed border-[var(--lo-line)] p-3">
      <Jar fill={0} size={64} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Save for..." aria-label="Jar name" maxLength={80} className="h-8 w-full rounded-[var(--lo-r-sm)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-2 text-[13px] font-semibold outline-none focus:border-[var(--lo-accent)]" />
      <div className="flex w-full gap-1">
        <input value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} inputMode="decimal" placeholder="Goal amount" aria-label="Goal amount" className="num h-8 min-w-0 flex-1 rounded-[var(--lo-r-sm)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-2 text-[13px] font-bold outline-none focus:border-[var(--lo-accent)]" />
        <button type="button" disabled={name.trim() === ''} onClick={() => void add()} className="h-8 rounded-[var(--lo-r-sm)] bg-[var(--lo-primary)] px-2 text-[12px] font-extrabold text-white disabled:opacity-40">
          Start
        </button>
      </div>
    </div>
  );
}

function NewBill(): React.JSX.Element {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('1');
  const add = async (): Promise<void> => {
    if (name.trim() === '') return;
    await op('bills.create', { name: name.trim(), amount: amount.trim() === '' ? '0' : amount.trim(), due_day: Number(day) });
    moneyChanged();
    snack(`${name.trim()} added to your bills`);
    setName('');
    setAmount('');
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rent, phone, streaming" aria-label="Bill" maxLength={80} className={cn(field, 'min-w-0 flex-1')} />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount" aria-label="Bill amount" className={cn(field, 'num w-28 font-bold')} />
      <label className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--lo-ink-2)]">
        on day
        <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day of the month" className={cn(field, 'w-20 px-2')}>
          {Array.from({ length: 31 }, (_, i) => (
            <option key={i} value={String(i + 1)}>
              {i + 1}
            </option>
          ))}
        </select>
      </label>
      <Button variant="primary" disabled={name.trim() === ''} onClick={() => void add()}>
        Add bill
      </Button>
    </div>
  );
}

function BudgetSet({ current }: { current: number }): React.JSX.Element {
  const s = useStatus().data;
  const [v, setV] = useState(current > 0 ? String(current / Math.pow(10, s?.digits ?? 2)) : '');
  const save = async (): Promise<void> => {
    await op('settings.update', { month_budget: v.trim() === '' ? '0' : v.trim() });
    moneyChanged();
    snack('Budget set', { undo: false });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {current > 0 && <span className="text-[12px] font-bold text-[var(--lo-muted)]">Monthly budget</span>}
      <span className="text-[13px] font-bold text-[var(--lo-muted)]">{s?.currency}</span>
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} inputMode="decimal" placeholder="2000" aria-label="Monthly budget" className={cn(field, 'num w-32 font-extrabold')} />
      <Button variant="primary" size="sm" onClick={() => void save()}>
        {current > 0 ? 'Change' : 'Set the monthly budget'}
      </Button>
    </div>
  );
}

function EntryRow({ e }: { e: MoneyEntry }): React.JSX.Element {
  const fmt = useMoney();
  const today = useStatus().data?.today ?? '';
  const digits = useStatus().data?.digits ?? 2;
  const label = [...SPEND_CATEGORIES, ...INCOME_CATEGORIES].find((c) => c.key === e.category)?.label ?? e.category;
  return (
    <li data-row className={cn('group flex h-11 items-center gap-3 rounded-[var(--lo-r-sm)] px-2 hover:bg-[var(--lo-sunk)]', enter(e.id))}>
      <CategoryArt category={e.category} size={30} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{e.note !== '' ? e.note : label}</span>
        <span className="block text-[12px] text-[var(--lo-muted)]">
          {label} · {relDay(e.date, today)}
        </span>
      </span>
      <span className={cn('num text-[14px] font-extrabold', e.kind === 'income' && 'text-[var(--lo-green-text)]')}>{e.kind === 'income' ? '+' : ''}{fmt(e.amount)}</span>
      <button
        type="button"
        aria-label="Delete"
        onClick={(ev) => {
          void vanish(rowOf(ev), [drop(e.id), moved(e.kind, String(e.amount / 10 ** digits), e.category, -1)], () => op('money.delete', { entry: e.id }), [...MONEY_READS]).then((r) => r !== undefined && snack('Deleted'));
        }}
        className="hit flex size-7 items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-muted)] opacity-0 hover:bg-[var(--lo-card)] focus:opacity-100 group-hover:opacity-100"
      >
        <X size={13} />
      </button>
    </li>
  );
}

export default function MoneyTool(): React.JSX.Element {
  const fmt = useMoney();
  const today = useStatus().data?.today ?? '';
  const live = useLive<MoneyMonth>((signal) => op('money.month', {}, { quiet: true, signal }), [...READS], []);
  const m = live.data;
  if (m === null) return <Skeleton className="h-48 w-full" />;
  const monthName = MONTHS[parseDay(m.month + '-01').getMonth()];
  const maxCat = Math.max(1, ...m.by_category.map((c) => c.amount));
  const bills = [...m.bills].sort((a, b) => (a.paid === b.paid ? a.in_days - b.in_days : a.paid ? 1 : -1));
  return (
    <>
      <Panel title={`${monthName} so far`} art={<AreaArt kind="money" size={26} />} note={m.budget > 0 ? `Budget ${fmt(m.budget, { whole: true })}` : undefined}>
        <div className="flex flex-wrap items-center gap-5">
          <Jar fill={m.budget > 0 && m.left !== null ? Math.max(0, m.left) / m.budget : m.spent > 0 ? 0.2 : 0} size={128} label="This month" />
          <div className="min-w-0 flex-1">
            {m.budget > 0 && m.left !== null ? (
              <>
                <p className={cn('num text-[26px] font-extrabold leading-8', m.left < 0 && 'text-[var(--lo-red-text)]')}>{fmt(Math.abs(m.left))}</p>
                <p className="text-[14px] font-semibold">{m.left < 0 ? 'over the budget' : 'left to spend'}</p>
                <Meter value={m.spent / m.budget} color={m.left < 0 ? 'var(--lo-red)' : 'var(--lo-k-money)'} className="mt-2" height={8} label="Spent of the budget" />
                <p className="mt-2 text-[12px] font-semibold text-[var(--lo-ink-2)]">
                  {fmt(m.spent)} spent of {fmt(m.budget)}
                  {m.per_day_left !== null && m.left > 0 ? ` · about ${fmt(m.per_day_left)} a day for ${m.days_left} days` : ''}
                </p>
                {m.last_month_same_point > 0 && <p className="text-[12px] font-semibold text-[var(--lo-muted)]">{m.spent <= m.last_month_same_point ? `${fmt(m.last_month_same_point - m.spent)} less than last month by now` : `${fmt(m.spent - m.last_month_same_point)} more than last month by now`}</p>}
              </>
            ) : (
              <>
                <p className="num text-[26px] font-extrabold leading-8">{fmt(m.spent)}</p>
                <p className="mb-3 text-[14px] font-semibold">spent so far</p>
                <BudgetSet current={0} />
              </>
            )}
            {m.income > 0 && <p className="mt-1 text-[12px] font-bold text-[var(--lo-green-text)]">{fmt(m.income)} came in</p>}
          </div>
          {m.budget > 0 && (
            <div className="w-full border-t border-[var(--lo-hair)] pt-3">
              <BudgetSet current={m.budget} />
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Note a spend" art={<CategoryArt category="food" size={26} />}>
        <SpendPad />
      </Panel>

      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
        <Panel title="Where it went" art={<CategoryArt category="shopping" size={26} />}>
          {m.by_category.length === 0 ? (
            <p className="text-[13px] text-[var(--lo-muted)]">Nothing spent yet this month.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {m.by_category.map((c) => (
                <li key={c.category} className="grid grid-cols-[30px_110px_1fr_auto] items-center gap-2">
                  <CategoryArt category={c.category} size={28} />
                  <span className="truncate text-[13px] font-bold">{[...SPEND_CATEGORIES, ...INCOME_CATEGORIES].find((x) => x.key === c.category)?.label ?? c.category}</span>
                  <Meter value={c.amount / maxCat} color="var(--lo-k-money)" height={8} />
                  <span className="num text-[13px] font-extrabold">{fmt(c.amount, { whole: true })}</span>
                </li>
              ))}
            </ul>
          )}
          {m.daily.some((x) => x.spent > 0) && (
            <div className="mt-4">
              <p className="pb-1 text-[12px] font-bold text-[var(--lo-muted)]">Day by day</p>
              <Bars values={m.daily.map((x) => x.spent)} labels={m.daily.map((x) => x.date)} color="var(--lo-k-money)" height={64} highlight={m.daily.findIndex((x) => x.date === today)} format={(v) => fmt(v)} />
            </div>
          )}
        </Panel>

        <Panel title="Lately" art={<ThingArt kind="envelope" size={24} />} bodyClassName="p-2 md:p-3">
          {m.entries.length === 0 ? <p className="p-2 text-[13px] text-[var(--lo-muted)]">Spends you note show up here.</p> : <ul className="flex flex-col">{m.entries.slice(0, 8).map((e) => <EntryRow key={e.id} e={e} />)}</ul>}
        </Panel>
      </div>

      <Panel title="Jars" art={<Jar fill={0.6} size={26} />} note={m.pots.length > 0 ? `${m.pots.length} saving` : undefined}>
        <div className="flex flex-wrap gap-6">
          {m.pots.map((p) => (
            <PotCard key={p.id} pot={p} />
          ))}
          <NewPot />
        </div>
      </Panel>

      <Panel title="Bills" art={<CategoryArt category="bills" size={26} />} note={bills.length > 0 ? `${bills.filter((b) => !b.paid).length} to pay` : undefined}>
        {bills.length > 0 && (
          <ul className="mb-3 flex flex-col gap-1">
            {bills.map((b) => (
              <li key={b.id} className={cn('flex h-12 items-center gap-3 rounded-[var(--lo-r)] border px-3', b.paid ? 'border-transparent bg-[var(--lo-sunk)]' : b.late ? 'border-transparent bg-[var(--lo-red)]/10' : 'border-[var(--lo-hair)] bg-[var(--lo-card)]')}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={b.paid}
                  aria-label={b.paid ? `${b.name}: paid. Tap to undo` : `Pay ${b.name}`}
                  onClick={() => {
                    if (!b.paid) snack(`Paid ${b.name}`);
                    void act([patch<Bill>(b.id, { paid: !b.paid, late: false })], () => op('bills.pay', { bill: b.id, paid: !b.paid }), [...MONEY_READS]);
                  }}
                  className={cn('hit flex size-6 items-center justify-center rounded-full border-2', b.paid ? 'border-[var(--lo-moss)] bg-[var(--lo-moss)] text-white' : 'border-[var(--lo-line)] hover:bg-[var(--lo-moss-soft)]')}
                >
                  {b.paid && <Check size={13} strokeWidth={3} />}
                </button>
                <span className={cn('min-w-0 flex-1 truncate text-[14px] font-bold', b.paid && 'text-[var(--lo-muted)] line-through')}>{b.name}</span>
                <span className={cn('text-[12px] font-bold', b.late && !b.paid ? 'text-[var(--lo-red-text)]' : 'text-[var(--lo-muted)]')}>{b.paid ? 'Paid' : b.late ? 'Late' : relDay(b.due_date, today)}</span>
                <span className="num w-24 text-right text-[14px] font-extrabold">{fmt(b.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <NewBill />
      </Panel>
    </>
  );
}
