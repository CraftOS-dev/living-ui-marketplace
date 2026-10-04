/**
 * Renewals tabs after the decision: instructing the provider and recording
 * payment, the multi-year cost forecast, and the history of what was paid
 * or let go.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CalendarRange, History, Send } from 'lucide-react';
import { Button, cn } from '../../kit/index.ts';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, fmtDateTime, fmtMoney, plural } from '../lib/format.ts';
import { INSTRUCTION_LABEL } from '../lib/labels.ts';
import { href, useHashParam } from '../lib/router.ts';
import type { ForecastResponse } from '../lib/types.ts';
import { YearForecast } from './charts.tsx';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { Checkbox, EmptyHint, ErrorBox, JurChip, Loading, Ref, Section, Segmented, Tag } from './ui.tsx';
import {
  CostCell,
  DecisionPill,
  DueCell,
  InstructDialog,
  PaymentDialog,
  ReceiptControl,
  RenewalSubject,
  matterOf,
} from './renewShared.tsx';
import type { RenewalX } from './renewShared.tsx';

/* ------------------------------------------------------------------ */
/* Instructions                                                        */
/* ------------------------------------------------------------------ */

function InstructionRow({
  r,
  leading,
  detail,
  actions,
}: {
  r: RenewalX;
  leading?: ReactNode | undefined;
  detail?: ReactNode | undefined;
  actions?: ReactNode | undefined;
}): React.JSX.Element {
  const m = matterOf(r);
  return (
    <div className="flex flex-col gap-2 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {leading}
        <div className="min-w-0">
          <RenewalSubject r={r} showType />
          <div className="mt-0.5 truncate text-[13px]">
            <span className="font-medium">{r.cycle_label}</span>
            {m !== undefined && <span className="text-[var(--agent-app-muted)]"> · {m.title}</span>}
          </div>
          {r.decision === 'renew_partial' && (r.classes_keep ?? []).length > 0 && (
            <div className="text-xs text-[var(--agent-app-muted)]">Keeping classes {(r.classes_keep ?? []).join(', ')}</div>
          )}
          {detail !== undefined && <div className="mt-0.5 text-xs text-[var(--agent-app-muted)]">{detail}</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pl-7 md:pl-0">
        <DueCell due={r.due_date} />
        <div className="min-w-24">
          <CostCell r={r} />
        </div>
        {actions !== undefined && <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  );
}

function SectionEmpty({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="px-4 py-4 text-[13px] text-[var(--agent-app-muted)]">{children}</p>;
}

export function InstructionsTab({ onGoDecisions }: { onGoDecisions: () => void }): React.JSX.Element {
  const { can } = useApp();
  const list = useCollection<RenewalX>('renewals', {
    filter:
      '(decision = "renew" || decision = "renew_partial") && (instruction_status = "not_instructed" || instruction_status = "" || instruction_status = "instructed" || instruction_status = "paid")',
    sort: 'due_date',
    expand: 'matter',
  });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [instruct, setInstruct] = useState<RenewalX[] | null>(null);
  const [pay, setPay] = useState<RenewalX | null>(null);

  const ready = list.records.filter((r) => r.instruction_status === 'not_instructed' || r.instruction_status === '');
  const instructed = list.records.filter((r) => r.instruction_status === 'instructed');
  const paid = list.records.filter((r) => r.instruction_status === 'paid');
  const selected = ready.filter((r) => sel.has(r.id));
  const allSel = ready.length > 0 && selected.length === ready.length;

  if (list.loading && list.records.length === 0) return <Loading />;
  if (list.error !== null) return <ErrorBox message={list.error} onRetry={list.refresh} />;
  if (list.records.length === 0) {
    return (
      <Section title="Instructions" flush>
        <EmptyHint
          icon={Send}
          title="Nothing to instruct"
          message="Renewals decided as Renew appear here, ready to send to your renewal provider. Decide on upcoming renewals first."
          action={<Button onClick={onGoDecisions}>Go to decisions</Button>}
        />
      </Section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Ready to instruct"
        meta={String(ready.length)}
        flush
        actions={
          can.manage && ready.length > 0 ? (
            <Button size="sm" onClick={() => setInstruct(selected.length > 0 ? selected : ready)}>
              <Send size={13} aria-hidden /> {selected.length > 0 ? `Instruct ${selected.length} selected` : `Instruct all ${ready.length}`}
            </Button>
          ) : undefined
        }
      >
        {ready.length === 0 ? (
          <SectionEmpty>Every renewal decided as Renew has been instructed.</SectionEmpty>
        ) : (
          <>
            {can.manage && (
              <div className="border-b border-[var(--agent-app-border)]/70 bg-[var(--agent-app-border)]/20 px-4 py-1.5">
                <Checkbox
                  checked={allSel}
                  indeterminate={!allSel && selected.length > 0}
                  onChange={(v) => setSel(v ? new Set(ready.map((r) => r.id)) : new Set())}
                  label={<span className="text-xs text-[var(--agent-app-muted)]">Select all</span>}
                />
              </div>
            )}
            {ready.map((r) => (
              <InstructionRow
                key={r.id}
                r={r}
                leading={
                  can.manage ? (
                    <div className="pt-0.5">
                      <Checkbox
                        checked={sel.has(r.id)}
                        ariaLabel={`Select ${matterOf(r)?.ref ?? r.cycle_label}`}
                        onChange={(v) =>
                          setSel((s) => {
                            const n = new Set(s);
                            if (v) n.add(r.id);
                            else n.delete(r.id);
                            return n;
                          })
                        }
                      />
                    </div>
                  ) : undefined
                }
              />
            ))}
          </>
        )}
      </Section>

      <Section title="Instructed, awaiting payment" meta={String(instructed.length)} flush>
        {instructed.length === 0 ? (
          <SectionEmpty>No renewals are waiting for the provider to pay.</SectionEmpty>
        ) : (
          instructed.map((r) => (
            <InstructionRow
              key={r.id}
              r={r}
              detail={
                <>
                  Instructed with {r.provider || 'a provider'}
                  {r.po_number !== '' ? ` · PO ${r.po_number}` : ''}
                  {d10(r.instructed_at) !== '' ? ` · ${fmtDateTime(r.instructed_at)}` : ''}
                </>
              }
              actions={
                <>
                  <ReceiptControl item={r} canEdit={can.edit} />
                  {can.manage && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPay(r)}>
                      Record payment
                    </Button>
                  )}
                </>
              }
            />
          ))
        )}
      </Section>

      <Section title="Paid, awaiting confirmation" meta={String(paid.length)} flush>
        {paid.length === 0 ? (
          <SectionEmpty>No payments are waiting to be confirmed.</SectionEmpty>
        ) : (
          paid.map((r) => (
            <InstructionRow
              key={r.id}
              r={r}
              detail={
                <>
                  Paid{d10(r.paid_date) !== '' ? ` ${fmtDate(r.paid_date)}` : ''}
                  {r.paid_amount > 0 ? ` · ${fmtMoney(r.paid_amount, r.currency || r.home_currency)}` : ''}
                  {r.provider !== '' ? ` · ${r.provider}` : ''}
                </>
              }
              actions={
                <>
                  <ReceiptControl item={r} canEdit={can.edit} />
                  {can.manage && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPay(r)}>
                      Confirm payment
                    </Button>
                  )}
                </>
              }
            />
          ))
        )}
      </Section>

      {instruct !== null && (
        <InstructDialog
          items={instruct}
          onClose={() => setInstruct(null)}
          onDone={() => {
            setSel(new Set());
            list.refresh();
          }}
        />
      )}
      {pay !== null && <PaymentDialog item={pay} onClose={() => setPay(null)} onDone={list.refresh} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Forecast                                                            */
/* ------------------------------------------------------------------ */

type ForecastItem = ForecastResponse['items'][number] & { id: string };

const YEAR_OPTIONS = [
  { value: '3', label: '3 years' },
  { value: '5', label: '5 years' },
  { value: '10', label: '10 years' },
] as const;

export function ForecastTab(): React.JSX.Element {
  const { vocab } = useApp();
  const [yrs, setYrs] = useHashParam('years', '5');
  const n = yrs === '3' ? 3 : yrs === '10' ? 10 : 5;
  // Re-projects itself when renewals, fees, rates or the home currency change.
  const fc = useLiveAsync(() => op<ForecastResponse>('renewals/forecast', { years: n }), [n], ['renewals', 'deadlines', 'matters', 'goods_services', 'fee_schedule', 'fx_rates', 'settings']);
  const data = fc.data;

  const items = useMemo<ForecastItem[]>(() => (data?.items ?? []).map((it, i) => ({ ...it, id: `${it.matter_id}-${it.date}-${i}` })), [data]);
  const currency = data?.currency ?? 'USD';
  const total = (data?.years ?? []).reduce((a, y) => a + y.total, 0);
  const unknown = (data?.years ?? []).reduce((a, y) => a + y.unknown, 0);
  const scheduled = items.filter((i) => !i.projected).length;

  const byProperty = useMemo(() => {
    const years = (data?.years ?? []).map((y) => y.year);
    const map = new Map<string, { amounts: Record<string, number>; unknown: Record<string, number>; total: number }>();
    for (const it of items) {
      const key = it.property || 'Unassigned';
      const row = map.get(key) ?? { amounts: {}, unknown: {}, total: 0 };
      if (it.home_amount !== null && it.home_amount > 0) {
        row.amounts[it.year] = (row.amounts[it.year] ?? 0) + it.home_amount;
        row.total += it.home_amount;
      } else {
        row.unknown[it.year] = (row.unknown[it.year] ?? 0) + 1;
      }
      map.set(key, row);
    }
    const rows = [...map.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
    return { years, rows };
  }, [data, items]);

  const columns: Col<ForecastItem>[] = [
    { key: 'date', label: 'Date', value: (r) => r.date, render: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDate(r.date)}</span> },
    {
      key: 'ref',
      label: 'Ref',
      render: (r) => (
        <a href={href('matter', r.matter_id)} className="hover:underline" onClick={(e) => e.stopPropagation()}>
          <Ref>{r.ref}</Ref>
        </a>
      ),
    },
    { key: 'title', label: 'Renewal', render: (r) => <span className="line-clamp-2">{r.title}</span> },
    { key: 'jurisdiction', label: 'Office', render: (r) => <JurChip code={r.jurisdiction} /> },
    { key: 'property', label: vocab.property },
    {
      key: 'amount',
      label: 'Official fee',
      align: 'right',
      value: (r) => r.amount,
      render: (r) => (r.amount > 0 ? fmtMoney(r.amount, r.currency) : <span className="text-xs text-[var(--agent-app-muted)]">No fee on file</span>),
    },
    {
      key: 'home_amount',
      label: `In ${currency}`,
      align: 'right',
      value: (r) => r.home_amount ?? '',
      render: (r) => (r.home_amount !== null && r.home_amount > 0 ? fmtMoney(r.home_amount, currency) : <span className="text-[var(--agent-app-muted)]">-</span>),
    },
    {
      key: 'projected',
      label: 'Basis',
      value: (r) => (r.projected ? 'Projected' : 'Scheduled'),
      render: (r) =>
        r.projected ? (
          <Tag title="A future cycle calculated from the rules; no deadline exists yet.">Projected</Tag>
        ) : (
          <Tag title="An open renewal deadline already in the docket." className="border-[var(--agent-app-text)]/30 text-[var(--agent-app-text)]/80">
            Scheduled
          </Tag>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[13px]">
          {data !== null && (
            <>
              <span className="font-semibold tabular-nums">
                {n}-year total: {fmtMoney(total, currency)}
              </span>
              {unknown > 0 && <span className="text-[var(--agent-app-muted)]">, plus {plural(unknown, 'renewal')} without a fee on file</span>}
              <span className="text-[var(--agent-app-muted)]">
                {' '}
                · {plural(scheduled, 'scheduled renewal')}, {plural(items.length - scheduled, 'projected cycle')}
              </span>
            </>
          )}
        </div>
        <Segmented value={String(n)} options={YEAR_OPTIONS} onChange={(v) => setYrs(v)} ariaLabel="Forecast horizon" />
      </div>

      {fc.loading && data === null ? (
        <Loading label="Calculating the forecast" />
      ) : fc.error !== null ? (
        <ErrorBox message={fc.error} onRetry={fc.reload} />
      ) : data === null || items.length === 0 ? (
        <Section title="Forecast" flush>
          <EmptyHint
            icon={CalendarRange}
            title={`No renewals in the next ${n} years`}
            message="The forecast adds up open annuity, maintenance and renewal deadlines plus the future cycles the rules will create."
          />
        </Section>
      ) : (
        <>
          <Section title="Spend by year" meta={`${currency}, converted at today's rates`}>
            <YearForecast years={data.years} currency={currency} />
          </Section>

          <Section title={`By ${vocab.property.toLowerCase()}`} meta={currency} flush>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{vocab.property}</th>
                    {byProperty.years.map((y) => (
                      <th key={y} className="px-3 py-2 text-right font-mono text-[11px] font-semibold text-[var(--agent-app-muted)]">
                        {y}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {byProperty.rows.map(([name, row]) => (
                    <tr key={name} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{name}</td>
                      {byProperty.years.map((y) => (
                        <td key={y} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {row.amounts[y] !== undefined ? fmtMoney(row.amounts[y], currency) : <span className="text-[var(--agent-app-muted)]">-</span>}
                          {(row.unknown[y] ?? 0) > 0 && (
                            <div className="text-[11px] text-[var(--agent-app-muted)]" title="Renewals without a fee on file are not in the amount">
                              +{row.unknown[y]} no fee
                            </div>
                          )}
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{fmtMoney(row.total, currency)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20">
                    <td className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">All</td>
                    {data.years.map((y) => (
                      <td key={y.year} className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                        {fmtMoney(y.total, currency)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{fmtMoney(total, currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Every renewal in the forecast" flush>
            <DataTable<ForecastItem> tableId="renewal-forecast" rows={items} columns={columns} exportName={`renewal-forecast-${n}-years`} dense />
          </Section>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function HistoryTab(): React.JSX.Element {
  const { userName } = useApp();
  const list = useCollection<RenewalX>('renewals', {
    filter: 'instruction_status = "confirmed" || instruction_status = "lapsed" || decision = "lapse"',
    sort: '-due_date',
    expand: 'matter',
  });

  const columns: Col<RenewalX>[] = [
    {
      key: 'ref',
      label: 'Ref',
      value: (r) => matterOf(r)?.ref ?? '',
      render: (r) => <RenewalSubject r={r} />,
    },
    {
      key: 'cycle_label',
      label: 'Renewal',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium">{r.cycle_label}</div>
          <div className="truncate text-xs text-[var(--agent-app-muted)]">{matterOf(r)?.title ?? ''}</div>
        </div>
      ),
    },
    { key: 'due_date', label: 'Due', value: (r) => d10(r.due_date), render: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDate(r.due_date)}</span> },
    {
      key: 'decision',
      label: 'Decision',
      value: (r) => r.decision,
      render: (r) => (
        <div className="flex flex-col items-start gap-1">
          <DecisionPill decision={r.decision} />
          {r.instruction_status !== '' && r.instruction_status !== 'not_instructed' && (
            <span className="text-[11px] text-[var(--agent-app-muted)]">{INSTRUCTION_LABEL[r.instruction_status]}</span>
          )}
        </div>
      ),
    },
    { key: 'decided_by', label: 'Decided by', value: (r) => userName(r.decided_by), render: (r) => userName(r.decided_by) || <span className="text-[var(--agent-app-muted)]">-</span> },
    {
      key: 'paid_date',
      label: 'Paid on',
      value: (r) => d10(r.paid_date),
      render: (r) => (d10(r.paid_date) !== '' ? <span className="whitespace-nowrap tabular-nums">{fmtDate(r.paid_date)}</span> : <span className="text-[var(--agent-app-muted)]">-</span>),
    },
    {
      key: 'paid_amount',
      label: 'Paid',
      align: 'right',
      value: (r) => r.paid_amount,
      render: (r) => (r.paid_amount > 0 ? fmtMoney(r.paid_amount, r.currency || r.home_currency) : <span className="text-[var(--agent-app-muted)]">-</span>),
    },
    { key: 'rationale', label: 'Reason', render: (r) => <span className="line-clamp-2 max-w-72 text-[var(--agent-app-text)]/85">{r.rationale || '-'}</span> },
    { key: 'provider', label: 'Provider', optional: true },
    {
      key: 'receipt',
      label: 'Receipt',
      optional: true,
      value: (r) => (r.receipt ? 'Yes' : ''),
      render: (r) => <ReceiptControl item={r} canEdit={false} />,
    },
  ];

  if (list.loading && list.records.length === 0) return <Loading />;
  if (list.error !== null) return <ErrorBox message={list.error} onRetry={list.refresh} />;

  return (
    <Section title="Paid and lapsed renewals" flush>
      <DataTable<RenewalX>
        tableId="renewal-history"
        rows={list.records}
        columns={columns}
        exportName="renewal-history"
        rowClassName={(r) => cn(r.decision === 'lapse' && 'text-[var(--agent-app-text)]/80')}
        empty={
          <EmptyHint
            icon={History}
            title="No renewal history yet"
            message="Confirmed payments and rights you decided to let lapse are kept here with who decided and why."
          />
        }
      />
    </Section>
  );
}
