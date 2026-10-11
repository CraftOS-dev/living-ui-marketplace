/**
 * Activity: the store's permanent audit log. Sign-ins and wrong PINs,
 * removed lines and cleared sales, price changes, discounts and tax
 * removed, refunds, voided payments, drawer opens and cash in and out,
 * stock, balances, staff, permissions and settings changes, each with who
 * did it and who approved it. Your AI agent's actions are marked as its.
 */
import { useEffect, useState } from 'react';
import { History, Sparkles } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { when } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { href } from '../lib/router.ts';
import { DateRange, LoadMore, presetRange } from '../components/common.tsx';
import type { Range } from '../components/common.tsx';
import { Badge, Empty, PageHeader, Panel, Select } from '../components/ui.tsx';
import type { Tone } from '../components/ui.tsx';

const KINDS: Record<string, { label: string; tone: Tone }> = {
  sign_in: { label: 'Signed in', tone: 'neutral' },
  pin_failed: { label: 'Wrong PIN', tone: 'bad' },
  line_removed: { label: 'Line removed', tone: 'warn' },
  order_voided: { label: 'Sale cleared', tone: 'warn' },
  price_override: { label: 'Price changed', tone: 'warn' },
  discount: { label: 'Discount', tone: 'warn' },
  tax_exempt: { label: 'Tax removed', tone: 'warn' },
  return: { label: 'Return', tone: 'warn' },
  payment_voided: { label: 'Payment voided', tone: 'bad' },
  no_sale: { label: 'No sale', tone: 'warn' },
  pay_in: { label: 'Paid in', tone: 'neutral' },
  pay_out: { label: 'Paid out', tone: 'warn' },
  shift_open: { label: 'Drawer opened', tone: 'neutral' },
  shift_close: { label: 'Drawer closed', tone: 'neutral' },
  stock: { label: 'Stock', tone: 'neutral' },
  balance: { label: 'Balance', tone: 'warn' },
  staff: { label: 'Team', tone: 'neutral' },
  permissions: { label: 'Permissions', tone: 'info' },
  settings: { label: 'Settings', tone: 'info' },
  catalog: { label: 'Catalog', tone: 'neutral' },
  delete: { label: 'Deleted', tone: 'bad' },
  clock: { label: 'Time clock', tone: 'neutral' },
};

export function ActivityPage(): React.JSX.Element {
  const { money } = useStore();
  const [range, setRange] = useState<Range>(presetRange('today'));
  const [kind, setKind] = useState('');
  const [staff, setStaff] = useState('');
  const [pages, setPages] = useState(1);
  useEffect(() => setPages(1), [range, kind, staff]);
  const team = useLive(() => api.staff(), ['staff'], []);
  const list = useLive(() => api.events({ kind: kind || undefined, staff: staff || undefined, from: range.from, to: range.to, limit: 100 * pages }), ['events'], [range.from, range.to, kind, staff, pages], 400);
  const rows = list.data?.events ?? [];
  return (
    <div>
      <PageHeader title="Activity" subtitle="Everything that changed money, stock or settings, with who did it" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <DateRange value={range} onChange={setRange} />
        <Select ariaLabel="Kind" value={kind} onChange={setKind} className="w-44" options={[{ value: '', label: 'Everything' }, ...Object.entries(KINDS).map(([k, v]) => ({ value: k, label: v.label }))]} />
        <Select ariaLabel="Who" value={staff} onChange={setStaff} className="w-44" options={[{ value: '', label: 'Everyone' }, ...(team.data?.staff ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
      </div>
      <Panel padded={false}>
        {list.loading && rows.length === 0 ? (
          <div className="py-10" />
        ) : rows.length === 0 ? (
          <Empty icon={History} title="Nothing happened in these days" compact />
        ) : (
          <ul className="divide-y divide-[var(--ps-hair)]">
            {rows.map((e) => {
              const k = KINDS[e.kind] ?? { label: e.kind, tone: 'neutral' as Tone };
              return (
                <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2">
                  <span className="w-36 shrink-0 text-[12px] text-[var(--ps-muted)]">{when(e.created)}</span>
                  <span className="w-28 shrink-0">
                    <Badge tone={k.tone}>{k.label}</Badge>
                  </span>
                  <span className="min-w-[200px] flex-1 text-[13px]">
                    {e.order !== '' ? (
                      <a href={href('order', { id: e.order })} className="hover:underline">
                        {e.detail}
                      </a>
                    ) : (
                      e.detail
                    )}
                    {e.approved_by !== null && <span className="text-[12px] text-[var(--ps-muted)]"> &middot; approved by {e.approved_by.name}</span>}
                  </span>
                  {e.amount !== null && e.amount !== 0 && <span className={cn('num shrink-0 text-[13px] font-semibold', e.amount < 0 && 'text-[var(--ps-red-text)]')}>{money.fmt(e.amount)}</span>}
                  <span className="flex w-36 shrink-0 items-center justify-end gap-1 text-right text-[12px] text-[var(--ps-ink-2)]">
                    {e.actor === 'agent' ? (
                      <>
                        <Sparkles size={12} className="text-[var(--ps-accent-text)]" />
                        Your AI agent
                      </>
                    ) : e.actor === 'system' ? (
                      'The app'
                    ) : (
                      (e.staff?.name ?? '')
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <LoadMore more={list.data?.more === true} loading={list.loading} onMore={() => setPages((n) => n + 1)} />
      </Panel>
    </div>
  );
}
