/** Where the money went: one month by category, the year by month, the biggest items. */
import { useState } from 'react';
import { ChartPie } from 'lucide-react';
import { Donut } from '../components/Donut.tsx';
import { useEntry } from '../components/Entry.tsx';
import { ExpenseRow } from '../components/ExpenseRow.tsx';
import { Bars } from '../components/charts.tsx';
import { Card, CardHeader, Empty, MonthSwitcher, PageHeader, Segments } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { headline, slicesOf } from '../lib/charts.ts';
import { useApp } from '../lib/context.tsx';
import { monthLabel, monthShort, thisMonth } from '../lib/dates.ts';
import { CategoryBadge } from '../lib/icons.tsx';
import { useLive } from '../lib/live.ts';
import { money } from '../lib/money.ts';
import { navigate } from '../lib/router.ts';

function Stat({ label, value, sub, delay }: { label: string; value: string; sub?: string | undefined; delay: number }): React.JSX.Element {
  return (
    <Card className="!p-5" delay={delay}>
      <p className="text-[13px] font-semibold text-[var(--et-muted)]">{label}</p>
      <p className="num mt-2 text-[26px] font-extrabold leading-8 tracking-[-0.01em]">{value}</p>
      {sub !== undefined && <p className="mt-1 text-[12px] text-[var(--et-ink-2)]">{sub}</p>}
    </Card>
  );
}

export function InsightsPage(): React.JSX.Element {
  const { currency, decimals } = useApp();
  const entry = useEntry();
  const [month, setMonth] = useState(thisMonth());
  const summary = useLive(() => api.month(month), ['expenses', 'categories', 'settings'], [month]);
  const trend = useLive(() => api.trend(12, thisMonth()), ['expenses'], []);
  const s = summary.data;
  const slices = s !== null ? slicesOf(s, currency) : [];
  const diff = s !== null ? s.total_minor - s.previous.total_minor : 0;

  return (
    <div>
      <PageHeader title="Insights" subtitle="Where your money goes, month by month." actions={<MonthSwitcher month={month} onChange={setMonth} />} />
      {s !== null && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            <Stat label="Spent" value={headline(s.total_minor, currency, decimals)} sub={s.budget !== null ? `${s.budget.used_pct}% of the budget` : undefined} delay={1} />
            <Stat label="Per day" value={money(s.daily_average_minor, currency, true)} sub={s.day_of_month > 0 ? `Over ${s.day_of_month} ${s.day_of_month === 1 ? 'day' : 'days'}` : undefined} delay={2} />
            <Stat label="Expenses" value={String(s.count)} sub={s.uncategorized > 0 ? `${s.uncategorized} without a category` : undefined} delay={3} />
            <Stat
              label={`vs ${monthLabel(s.previous.month, true)}`}
              value={s.previous.total_minor === 0 ? 'None yet' : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${money(Math.abs(diff), currency, true)}`}
              sub={s.previous.total_minor === 0 ? undefined : month === thisMonth() ? `By day ${s.previous.through_day}` : 'Whole month'}
              delay={4}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <Card tone="sand" className="flex flex-col lg:col-span-5" delay={2}>
              <CardHeader title={`${monthLabel(month, true)} at a glance`} subtitle="The five biggest categories, then the rest" />
              <div className="flex flex-1 flex-col items-center justify-center gap-6">
                <Donut
                  slices={slices}
                  centerValue={headline(s.total_minor, currency, decimals)}
                  centerCaption={monthLabel(month, true)}
                  size={300}
                  onPick={(key) => key !== 'rest' && navigate('expenses', { month, category: key })}
                />
                {slices.length > 0 && (
                  <ul className="grid w-full grid-cols-2 gap-x-5 gap-y-2.5">
                    {slices.map((sl) => (
                      <li key={sl.key} className="flex items-center gap-2.5">
                        <span aria-hidden className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: sl.fill }} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{sl.label}</span>
                        <span className="num text-[12px] font-bold text-[var(--et-ink-2)]">{sl.share}%</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
            <Card className="lg:col-span-7" delay={3}>
              <CardHeader title="By category" subtitle="Bars fill against each budget; without one, against the month." />
              {s.categories.length === 0 ? (
                <Empty icon={ChartPie} title={`Nothing spent in ${monthLabel(month)}`} />
              ) : (
                <div className="flex flex-col gap-2">
                  {s.categories.map((c) => (
                    <button
                      key={c.id ?? 'none'}
                      type="button"
                      onClick={() => navigate('expenses', { month, category: c.id ?? 'none' })}
                      className="flex items-center gap-3 rounded-[18px] bg-[var(--et-row)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--et-row-hover)]"
                    >
                      <CategoryBadge icon={c.icon} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold">{c.name}</span>
                        <span className="block text-[12px] text-[var(--et-muted)]">
                          {c.count} {c.count === 1 ? 'expense' : 'expenses'} · {c.share}%
                        </span>
                      </span>
                      <span className="hidden flex-col items-end gap-1 sm:flex">
                        <Segments value={c.total_minor} max={c.budget_minor > 0 ? c.budget_minor : s.total_minor} count={12} />
                        <span className="text-[12px] text-[var(--et-muted)]">{c.budget_minor > 0 ? `of ${money(c.budget_minor, currency, true)}` : 'of the month'}</span>
                      </span>
                      <span className="num w-24 text-right text-[14px] font-bold">{money(c.total_minor, currency)}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {trend.data !== null && (
            <Card delay={4}>
              <CardHeader title="Last 12 months" subtitle={`About ${money(trend.data.average_minor, currency, true)} a month. Pick a month to look at it.`} />
              <Bars
                height={200}
                maxBar={44}
                currency={currency}
                decimals={decimals}
                onPick={setMonth}
                items={trend.data.months.map((m) => ({
                  key: m.month,
                  label: monthShort(m.month),
                  short: monthShort(m.month).slice(0, 1),
                  value: m.total_minor,
                  tone: m.month === month ? 'selected' : 'normal',
                  tip: `${monthLabel(m.month)} · ${money(m.total_minor, currency)}`,
                }))}
              />
            </Card>
          )}

          {s.biggest.length > 0 && (
            <Card delay={5}>
              <CardHeader title="Biggest expenses" />
              <div className="flex flex-col gap-2">
                {s.biggest.map((e) => (
                  <ExpenseRow key={e.id} e={e} currency={currency} onOpen={(el, x) => entry.edit(el, x)} />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
