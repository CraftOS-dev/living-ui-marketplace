/** Monthly limits: one for the whole month, optional ones per category. Empty means no limit. */
import { useEffect, useState } from 'react';
import { cn, toast } from '../../kit/index.ts';
import { Gauge } from '../components/charts.tsx';
import { Card, CardHeader, PageHeader, Segments } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { monthLabel, thisMonth } from '../lib/dates.ts';
import { CategoryBadge } from '../lib/icons.tsx';
import { useLive } from '../lib/live.ts';
import { fieldAmount, money, normalizeAmount, symbolOf } from '../lib/money.ts';

/**
 * An amount field that saves when it loses focus or on Enter. Empty or 0 =
 * no limit. It reads as a field on any surface: its own fill and outline, an
 * action placeholder, and the currency symbol once there is an amount.
 */
function LimitInput({ minor, onSave, label }: { minor: number; onSave: (amount: string) => Promise<void>; label: string }): React.JSX.Element {
  const { currency, decimals } = useApp();
  const [text, setText] = useState(minor > 0 ? fieldAmount(minor, currency) : '');
  const [bad, setBad] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => setText(minor > 0 ? fieldAmount(minor, currency) : ''), [minor, currency]);
  const commit = async (): Promise<void> => {
    const t = text.trim();
    if (t === (minor > 0 ? fieldAmount(minor, currency) : '')) return;
    if (t === '' || t === '0') return onSave('0');
    const n = normalizeAmount(t, decimals);
    if (n === null) {
      setBad(true);
      return;
    }
    setBad(false);
    await onSave(n);
  };
  return (
    <label className="relative block w-36 shrink-0">
      {(text !== '' || focused) && (
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-[var(--et-muted)]">{symbolOf(currency)}</span>
      )}
      <input
        aria-label={label}
        value={text}
        inputMode="decimal"
        placeholder="Set limit"
        title={bad ? 'Use a number like 1,500 or 1500.50' : 'Empty means no limit'}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          void commit();
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className={cn(
          'num h-11 w-full rounded-full bg-[var(--et-card)] pl-9 pr-4 text-right text-[14px] font-semibold text-[var(--et-ink)] outline-none ring-1 ring-inset transition-shadow placeholder:font-medium hover:ring-[var(--et-ink-2)] focus-visible:ring-2 focus-visible:ring-[var(--et-ink)]',
          bad ? 'ring-2 ring-[var(--et-red)] hover:ring-[var(--et-red)]' : 'ring-[var(--et-line)]',
        )}
      />
    </label>
  );
}

export function BudgetsPage(): React.JSX.Element {
  const { currency, settings, categories } = useApp();
  const month = thisMonth();
  const summary = useLive(() => api.month(month), ['expenses', 'categories', 'settings'], [month]);
  const spent = new Map((summary.data?.categories ?? []).map((c) => [c.id ?? '', c.total_minor]));
  const total = summary.data?.total_minor ?? 0;
  const overall = settings?.monthly_budget_minor ?? 0;

  const saveOverall = async (amount: string): Promise<void> => {
    try {
      await api.updateSettings({ monthly_budget: amount });
      toast.success(amount === '0' ? 'Monthly budget removed' : 'Monthly budget saved');
    } catch {
      /* toasted */
    }
  };
  const saveCategory = async (id: string, amount: string): Promise<void> => {
    try {
      await api.updateCategory(id, { budget: amount });
      toast.success('Budget saved');
    } catch {
      /* toasted */
    }
  };

  return (
    <div>
      <PageHeader title="Budgets" subtitle={`Limits for every month. ${monthLabel(month)} so far is shown. Leave a box empty for no limit.`} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card className="flex flex-col items-center lg:col-span-4" delay={1}>
          <CardHeader title="Whole month" subtitle="Everything you spend" />
          <Gauge
            ratio={overall > 0 ? total / overall : 0}
            caption={overall === 0 ? 'No limit' : total <= overall ? 'Left' : 'Over by'}
            center={overall === 0 ? money(total, currency, true) : money(Math.abs(overall - total), currency, true)}
            bubble={overall > 0 ? money(total, currency, true) : undefined}
            size={190}
          />
          <div className="mt-4 flex w-full items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-[var(--et-ink-2)]">Monthly limit</span>
            <LimitInput minor={overall} onSave={saveOverall} label="Monthly budget" />
          </div>
        </Card>

        <Card className="lg:col-span-8" delay={2}>
          <CardHeader title="By category" subtitle="The bars fill as you spend; red means over." />
          <div className="flex flex-col gap-2">
            {categories.map((c) => {
              const used = spent.get(c.id) ?? 0;
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--et-row)] px-3 py-2.5">
                  <CategoryBadge icon={c.icon} size={36} />
                  <span className="min-w-[7rem] flex-1">
                    <span className="block text-[14px] font-bold">{c.name}</span>
                    <span className="num block text-[12px] text-[var(--et-muted)]">
                      {c.budget_minor > 0 ? `${money(used, currency)} of ${money(c.budget_minor, currency, true)}` : used > 0 ? `${money(used, currency)} this month` : 'Nothing this month'}
                    </span>
                  </span>
                  {c.budget_minor > 0 && <Segments value={used} max={c.budget_minor} count={12} className="hidden sm:inline-flex" />}
                  <LimitInput minor={c.budget_minor} onSave={(a) => saveCategory(c.id, a)} label={`Budget for ${c.name}`} />
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
