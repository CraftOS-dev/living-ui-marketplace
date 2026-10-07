/**
 * Home dashboard. The greeting and the add button on top; then where the
 * money went (the spending ring), which days it went (the dark calendar),
 * day by day (bars under the ring), the budget, the pace against last month
 * and the latest expenses.
 */
import { useState } from 'react';
import { ArrowUpRight, ChevronDown, FileUp, Pencil, Plus, ScanLine, Search, Wallet } from 'lucide-react';
import { toast } from '../../kit/index.ts';
import { Donut } from '../components/Donut.tsx';
import { useEntry } from '../components/Entry.tsx';
import { ExpenseRow } from '../components/ExpenseRow.tsx';
import { Bars, Gauge, PaceBar, SpendCalendar } from '../components/charts.tsx';
import { Card, CardHeader, CircleButton, Empty, Field, Modal, PillButton, PillSelect, Popover, StatusPill, TextLink, pillInput } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { dayBars, headline, slicesOf } from '../lib/charts.ts';
import { useApp } from '../lib/context.tsx';
import { addMonths, monthLabel, thisMonth } from '../lib/dates.ts';
import { useLive } from '../lib/live.ts';
import { CURRENCIES, currencyName, fieldAmount, money, normalizeAmount, symbolOf } from '../lib/money.ts';
import { navigate } from '../lib/router.ts';
import type { MonthSummary } from '../lib/types.ts';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function CurrencyQuestion({ current }: { current: string }): React.JSX.Element {
  const [code, setCode] = useState(current);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.updateSettings({ currency: code, currency_confirmed: true });
      toast.success(`Amounts are in ${code}`);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const options = (CURRENCIES.includes(current) ? CURRENCIES : [current, ...CURRENCIES]).map((c) => ({ value: c, label: `${c} · ${currencyName(c)}` }));
  return (
    <Card tone="sand" className="flex flex-wrap items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold">Which currency do you spend in?</p>
        <p className="text-[13px] text-[var(--et-ink-2)]">Every amount is kept in this currency. Spending abroad is converted for you.</p>
      </div>
      <PillSelect ariaLabel="Currency" value={code} onChange={setCode} options={options} className="w-64 max-w-full" />
      <PillButton variant="dark" loading={busy} onClick={() => void save()}>
        Use {code}
      </PillButton>
    </Card>
  );
}

function ReceiptsLine(): React.JSX.Element | null {
  const r = useLive(() => api.receipts(), ['receipts'], []);
  const list = r.data?.receipts ?? [];
  const waiting = list.filter((x) => x.status === 'waiting' || x.status === 'reading').length;
  const failed = list.filter((x) => x.status === 'failed').length;
  if (waiting === 0 && failed === 0) return null;
  return (
    <div className="et-rise flex flex-wrap items-center gap-3">
      {waiting > 0 && (
        <StatusPill tone="info" pulse>
          {waiting === 1 ? '1 receipt' : `${waiting} receipts`} with your AI agent
        </StatusPill>
      )}
      {failed > 0 && <StatusPill tone="bad">{failed === 1 ? '1 receipt' : `${failed} receipts`} could not be read</StatusPill>}
      <TextLink onClick={() => navigate('receipts')}>View receipts</TextLink>
    </div>
  );
}

function MonthMenu({ month, onChange }: { month: string; onChange: (m: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth(), -i));
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--et-dark-2)] px-3.5 text-[13px] font-semibold text-[var(--et-on-dark)]"
      >
        {monthLabel(month, true)}
        <ChevronDown size={14} aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="right" className="max-h-72 w-48 overflow-y-auto">
        {months.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              onChange(m);
              setOpen(false);
            }}
            className={`block w-full rounded-full px-3 py-2 text-left text-[13px] font-semibold hover:bg-[var(--et-row)] ${m === month ? 'bg-[var(--et-row)]' : ''}`}
          >
            {monthLabel(m)}
          </button>
        ))}
      </Popover>
    </div>
  );
}

function BudgetCard({ s, currency, decimals }: { s: MonthSummary; currency: string; decimals: number }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const b = s.budget;
  const open = (): void => {
    setText(b !== null ? fieldAmount(b.amount_minor, currency) : '');
    setEditing(true);
  };
  const save = async (): Promise<void> => {
    const t = text.trim();
    const value = t === '' || t === '0' ? '0' : normalizeAmount(t, decimals);
    if (value === null) {
      toast.error('Enter an amount like 1,500 or 1500.50');
      return;
    }
    setBusy(true);
    try {
      await api.updateSettings({ monthly_budget: value });
      toast.success(value === '0' ? 'Budget removed' : 'Budget saved');
      setEditing(false);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const ratio = b !== null && b.amount_minor > 0 ? s.total_minor / b.amount_minor : 0;
  return (
    <Card className="order-4 flex flex-col lg:order-none" delay={3}>
      <CardHeader title="Monthly budget" subtitle={b !== null ? 'Keep spending under your limit' : 'No limit set yet'} />
      <div className="flex flex-1 items-center justify-center">
        <Gauge
          ratio={ratio}
          caption={b === null ? 'No limit' : b.left_minor >= 0 ? 'Left' : 'Over by'}
          center={b === null ? money(s.total_minor, currency, true) : money(Math.abs(b.left_minor), currency, true)}
          bubble={b !== null ? money(s.total_minor, currency, true) : undefined}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold">{b !== null ? `${money(b.amount_minor, currency, true)} a month` : 'Set a monthly limit'}</span>
        <button type="button" onClick={open} className="inline-flex items-center gap-2 text-[13px] font-semibold">
          {b !== null ? 'Change' : 'Set budget'}
          <span className="flex size-8 items-center justify-center rounded-full bg-[var(--et-accent)] text-[var(--et-on-accent)]">
            <Pencil size={14} aria-hidden />
          </span>
        </button>
      </div>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Monthly budget"
        description="How much do you want to spend at most each month? Leave empty for no limit."
        footer={
          <>
            <PillButton variant="light" onClick={() => setEditing(false)}>
              Cancel
            </PillButton>
            <PillButton variant="dark" loading={busy} onClick={() => void save()}>
              Save
            </PillButton>
          </>
        }
      >
        <Field label={`Amount in ${currency}`}>
          <div className="relative">
            <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-[var(--et-muted)]">{symbolOf(currency)}</span>
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
              inputMode="decimal"
              placeholder="No limit"
              className={`${pillInput} num pl-10`}
            />
          </div>
        </Field>
      </Modal>
    </Card>
  );
}

export function HomePage(): React.JSX.Element {
  const { currency, decimals, settings } = useApp();
  const entry = useEntry();
  const [month, setMonth] = useState(thisMonth());
  const [q, setQ] = useState('');
  const summary = useLive(() => api.month(month), ['expenses', 'settings', 'categories'], [month]);
  const recent = useLive(() => api.list({ limit: 5 }), ['expenses', 'categories'], []);
  const s = summary.data;
  const slices = s !== null ? slicesOf(s, currency) : [];
  const isNow = month === thisMonth();
  const prevName = s !== null ? monthLabel(s.previous.month, true) : '';
  const spendDays = s !== null ? s.daily.filter((d) => d.total_minor > 0).length : 0;
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="flex flex-col gap-5">
      <header className="et-rise mb-1 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">{greeting()}</h1>
          <p className="mt-1 text-[13px] text-[var(--et-muted)]">{dateLine}. Here is where your money is going.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="relative hidden lg:block">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--et-muted)]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && q.trim() !== '' && navigate('expenses', { q: q.trim() })}
              placeholder="Search expenses"
              aria-label="Search expenses"
              className={`${pillInput} w-64 pl-11`}
            />
          </label>
          <PillButton variant="dark" icon={Plus} dot onClick={(e) => entry.add(e.currentTarget)} className="hidden md:inline-flex">
            Add expense
          </PillButton>
        </div>
      </header>

      {settings !== null && !settings.currency_confirmed && <CurrencyQuestion current={settings.currency} />}
      <ReceiptsLine />

      {s !== null && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
          <div className="contents lg:col-span-8 lg:flex lg:flex-col lg:gap-5">
          {/* Spending ring */}
          <Card tone="sand" className="order-1 lg:order-none" delay={1}>
            <CardHeader
              title={`Spending in ${monthLabel(month, true)}`}
              subtitle={s.count === 0 ? 'Nothing recorded yet' : `${s.count} ${s.count === 1 ? 'expense' : 'expenses'}. Pick a slice to see them.`}
              action={<CircleButton icon={ArrowUpRight} label="Open insights" variant="dark" size={36} onClick={() => navigate('insights')} />}
            />
            <div className="flex flex-col-reverse items-center gap-6 md:flex-row md:items-center md:justify-between">
              <div className="w-full md:max-w-[240px]">
                {slices.length === 0 ? (
                  <p className="text-[13px] text-[var(--et-ink-2)]">Add an expense and this ring shows where your money goes, category by category.</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {slices.map((sl) => (
                      <li key={sl.key}>
                        <button
                          type="button"
                          onClick={() => sl.key !== 'rest' && navigate('expenses', { month, category: sl.key })}
                          className="flex w-full items-center gap-3 rounded-full py-0.5 text-left"
                        >
                          <span aria-hidden className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: sl.fill }} />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{sl.label}</span>
                          <span className="num text-[13px] font-bold">{money(sl.value, currency)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Donut
                slices={slices}
                centerValue={headline(s.total_minor, currency, decimals)}
                centerCaption={isNow ? 'spent so far' : 'spent'}
                size={300}
                onPick={(key) => key !== 'rest' && navigate('expenses', { month, category: key })}
                chips={[
                  { icon: ScanLine, label: 'Scan a receipt', onClick: () => navigate('receipts') },
                  { icon: FileUp, label: 'Import a bank CSV', onClick: () => navigate('import') },
                  { icon: ArrowUpRight, label: 'Insights', onClick: () => navigate('insights') },
                ]}
              />
            </div>
          </Card>

          {/* Daily bars, under the ring */}
          <Card className="order-2 lg:order-none" delay={2}>
            <CardHeader
              title="Daily spending"
              subtitle={s.count > 0 ? `About ${money(s.daily_average_minor, currency)} a day` : 'Each day of the month'}
              action={
                <div className="hidden items-center gap-3 text-[12px] font-semibold text-[var(--et-ink-2)] sm:flex">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-[var(--et-ink)]" /> Spent
                  </span>
                  {isNow && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full bg-[var(--et-accent)]" /> Today
                    </span>
                  )}
                  {s.budget !== null && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full bg-[var(--et-sand-2)] ring-1 ring-[var(--et-line)]" /> Daily limit
                    </span>
                  )}
                </div>
              }
            />
            <Bars items={dayBars(s, currency)} currency={currency} decimals={decimals} height={190} onPick={(day) => navigate('expenses', { month, day })} />
          </Card>

          {/* Latest */}
          <Card className="order-6 lg:order-none" delay={5}>
            <CardHeader
              title="Recent expenses"
              action={
                <button type="button" onClick={(e) => entry.add(e.currentTarget.querySelector('span[data-plus]'))} className="inline-flex items-center gap-2.5 text-[13px] font-semibold">
                  Add new
                  <span data-plus className="flex size-8 items-center justify-center rounded-full bg-[var(--et-solid)] text-[var(--et-on-solid)]">
                    <Plus size={16} strokeWidth={2.4} aria-hidden />
                  </span>
                </button>
              }
            />
            {recent.data !== null && recent.data.count === 0 ? (
              <Empty
                icon={Wallet}
                title="No expenses yet"
                action={
                  <PillButton variant="dark" icon={Plus} dot onClick={(e) => entry.add(e.currentTarget)}>
                    Add your first expense
                  </PillButton>
                }
              >
                You can also hand your AI agent a receipt photo or a bank CSV file in chat.
              </Empty>
            ) : (
              <div className="flex flex-col gap-2">
                {(recent.data?.expenses ?? []).map((e) => (
                  <ExpenseRow key={e.id} e={e} currency={currency} onOpen={(el, x) => entry.edit(el, x)} />
                ))}
                {(recent.data?.count ?? 0) > 5 && (
                  <div className="pt-2 text-center">
                    <TextLink tone="muted" onClick={() => navigate('expenses')}>
                      See all {recent.data?.count} expenses
                    </TextLink>
                  </div>
                )}
              </div>
            )}
          </Card>
          </div>
          <div className="contents lg:col-span-4 lg:flex lg:flex-col lg:gap-5">
          {/* Spending days */}
          <Card tone="dark" className="order-3 lg:order-none" delay={2}>
            <CardHeader title="Spending days" dark subtitle={spendDays === 0 ? 'No spending yet' : `${spendDays} ${spendDays === 1 ? 'day' : 'days'} with spending`} action={<MonthMenu month={month} onChange={setMonth} />} />
            <SpendCalendar month={month} days={s.daily} currency={currency} onPick={(day) => navigate('expenses', { month, day })} />
          </Card>

          <BudgetCard s={s} currency={currency} decimals={decimals} />

          {/* Pace against last month */}
          <Card className="order-5 flex flex-col lg:order-none" delay={4}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold">Compared with {prevName}</h2>
                {s.previous.total_minor > 0 && <p className="mt-0.5 text-[13px] text-[var(--et-muted)]">{isNow ? `By day ${s.previous.through_day}` : 'Whole month'}</p>}
              </div>
              {s.previous.total_minor > 0 && (
                <div className="text-right">
                  <p className="num text-[26px] font-extrabold leading-8">{Math.round((s.total_minor / s.previous.total_minor) * 100)}%</p>
                  <p className="text-[12px] text-[var(--et-muted)]">of {prevName}</p>
                </div>
              )}
            </div>
            {s.previous.total_minor > 0 ? (
              <div className="mt-auto">
                <PaceBar ratio={s.total_minor / s.previous.total_minor} bubble={money(s.total_minor, currency, true)} />
                <div className="mt-3 flex justify-between text-[12px] font-semibold text-[var(--et-muted)]">
                  <span>{symbolOf(currency)}0</span>
                  <span className="num">{money(s.previous.total_minor, currency, true)}</span>
                </div>
              </div>
            ) : (
              <p className="mt-auto text-[13px] text-[var(--et-ink-2)]">Nothing to compare yet. Next month this shows whether you are spending more or less.</p>
            )}
          </Card>

          </div>
        </div>
      )}
      {s === null && <div className="h-96" />}
    </div>
  );
}
