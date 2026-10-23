/**
 * One customer or supplier: what is owed both ways and how late (an aging
 * ring), a year of sales or purchases, open documents, the statement of
 * account (printable, CSV), payments and credits not yet applied, contacts,
 * details, and the activity.
 */
import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  Download,
  FileText,
  Mail,
  Pencil,
  Phone,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  ScrollText,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { Bars } from '../../components/charts.tsx';
import type { BarPoint } from '../../components/charts.tsx';
import { Menu, ProgressBar, Segmented } from '../../components/controls.tsx';
import { Donut } from '../../components/Donut.tsx';
import { AGING, DateRangeButton, SHORT_TYPE, canDoc, canPay, listDay, openDoc } from '../../components/sales/parts.tsx';
import { ContactForm, PartyForm } from '../../components/sales/partyform.tsx';
import { docStatus } from '../../components/status.ts';
import { Avatar, Card, CardHeader, CircleButton, Empty, Figure, LoadError, PageHeader, PageSkeleton, PillButton, Skeleton, StatusPill, useConfirm } from '../../components/ui.tsx';
import { op, saveText } from '../../lib/api.ts';
import { addMonths, dayLabel, monthLabel, today } from '../../lib/dates.ts';
import { amount, decimalsOf, money, plural, qty } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { back, navigate, useSection } from '../../lib/router.ts';
import type { Aging, DocList, PartyContact, PartyDetail, PaymentRow, Statement } from '../../lib/types/sales.ts';
import type { PageProps } from '../../routes.tsx';

type Side = 'receivable' | 'payable';

function lateOf(a: Aging): number {
  return a.d30 + a.d60 + a.d90 + a.over90;
}

/* --------------------------------------------------------------- balance */

function BalanceCard({ p, side, setSide }: { p: PartyDetail; side: Side; setSide: (s: Side) => void }): React.JSX.Element {
  const cur = p.base_currency;
  const aging = side === 'receivable' ? p.aging_receivable : p.aging_payable;
  const owed = side === 'receivable' ? p.receivable : p.payable;
  const late = lateOf(aging);
  const total = AGING.reduce((s, a) => s + aging[a.key], 0);
  const credits = p.unallocated.filter((u) => (side === 'receivable' ? u.direction === 'in' : u.direction === 'out'));
  const slices = AGING.filter((a) => aging[a.key] > 0).map((a) => ({ key: a.key, label: a.short === 'Not due' ? 'Not due' : `${a.short} days`, value: aging[a.key], amount: money(aging[a.key], cur, 'short'), share: total > 0 ? Math.round((aging[a.key] / total) * 100) : 0, fill: a.fill, text: a.text }));
  const both = p.is_customer && p.is_supplier;
  return (
    <Card delay={1}>
      <CardHeader
        title={side === 'receivable' ? 'What they owe you' : 'What you owe them'}
        subtitle={side === 'receivable' ? `${plural(p.open.invoices, 'open invoice')}` : `${plural(p.open.bills, 'open bill')}`}
        action={
          both ? (
            <Segmented
              ariaLabel="Which way"
              value={side}
              onChange={setSide}
              options={[
                { value: 'receivable', label: 'They owe' },
                { value: 'payable', label: 'You owe' },
              ]}
            />
          ) : undefined
        }
      />
      <div className="grid grid-cols-2 gap-5">
        <Figure label={side === 'receivable' ? 'Owes you' : 'You owe'} value={money(owed, cur)} />
        <Figure label="Overdue" value={money(late, cur)} tone={late > 0 ? 'red' : 'ink'} sub={late > 0 && owed > 0 ? `${Math.round((late / Math.max(owed, total)) * 100)}% of it` : 'Nothing is late'} />
      </div>
      <div className="mt-6 flex flex-col items-center gap-6 @min-[480px]:flex-row @min-[480px]:items-center">
        <div className="w-[200px] shrink-0">
          <Donut slices={slices} centerValue={money(total, cur, 'short')} centerCaption={total > 0 ? 'Open' : 'Nothing open'} size={200} trackColor="var(--erp-row)" />
        </div>
        <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
          <ul className="flex flex-col gap-1.5">
            {AGING.map((a) => (
              <li key={a.key} className="flex items-center gap-3 text-[13px]">
                <span aria-hidden className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: a.fill }} />
                <span className="min-w-0 flex-1 truncate text-[var(--erp-ink-2)]">{a.label}</span>
                <span className={cn('num font-semibold', aging[a.key] === 0 && 'font-normal text-[var(--erp-muted)]')}>{money(aging[a.key], cur)}</span>
              </li>
            ))}
          </ul>
          {side === 'receivable' && p.credit_limit > 0 && (
            <div>
              <div className="mb-1.5 flex justify-between text-[12px] font-semibold">
                <span>Credit limit</span>
                <span className="num text-[var(--erp-muted)]">
                  {money(owed, cur, 'short')} of {money(p.credit_limit, cur, 'short')}
                </span>
              </div>
              <ProgressBar value={owed / p.credit_limit} tone={owed > p.credit_limit ? 'red' : owed > p.credit_limit * 0.8 ? 'amber' : 'ink'} />
            </div>
          )}
          {credits.length > 0 && (
            <p className="text-[13px] text-[var(--erp-ink-2)]">
              <span className="num font-semibold">{money(credits.reduce((s, c) => s + c.unallocated, 0), cur)}</span> paid but not applied yet
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- months */

function MonthsCard({ p }: { p: PartyDetail }): React.JSX.Element {
  const cur = p.base_currency;
  const d = 10 ** decimalsOf(cur);
  const now = p.months[p.months.length - 1]?.month ?? '';
  const points: BarPoint[] = p.months.map((m) => ({ key: m.month, label: monthLabel(m.month), axis: monthLabel(m.month, true).slice(0, 3), value: m.value / d, text: money(m.value, cur), current: m.month === now }));
  const year = p.is_customer ? p.sales_this_year : p.purchases_this_year;
  return (
    <Card delay={2}>
      <CardHeader title={p.is_customer ? 'Sales by month' : 'Purchases by month'} subtitle={`${money(year, cur)} this year`} />
      <Bars points={points} height={160} />
    </Card>
  );
}

/* -------------------------------------------------------- open documents */

function OpenDocs({ p }: { p: PartyDetail }): React.JSX.Element | null {
  const me = useMe();
  const types: ('invoice' | 'bill')[] = [...(p.is_customer && canDoc(me, 'invoice', 'view') ? (['invoice'] as const) : []), ...(p.is_supplier && canDoc(me, 'bill', 'view') ? (['bill'] as const) : [])];
  const open = useLive(
    async () => {
      const r = await Promise.all(types.map((t) => op<DocList>('docs.list', { type: t, party: p.id, status: 'unpaid', sort: 'due', desc: false, limit: 50 }, { quiet: true }).catch(() => null)));
      return r.flatMap((x) => x?.docs ?? []);
    },
    READS.docs,
    [p.id, types.join()],
  );
  const rows = open.data ?? [];
  if (types.length === 0) return null;
  return (
    <Card delay={2}>
      <CardHeader title="Open documents" subtitle={open.data !== null ? (rows.length > 0 ? `${plural(rows.length, 'document')} with money open` : 'Nothing open') : undefined} icon={ReceiptText} />
      {open.data === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : rows.length === 0 ? (
        <Empty icon={ReceiptText} title="All settled" compact>
          No invoices or bills are open.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => openDoc(r.id)} className={cn('flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-[var(--erp-row-hover)]', r.status === 'overdue' ? 'bg-[var(--erp-red)]/8' : 'bg-[var(--erp-row)]')}>
                <span className="min-w-0 flex-1">
                  <span className="num block truncate text-[14px] font-bold">
                    {SHORT_TYPE[r.type]} {r.number}
                  </span>
                  <span className={cn('block truncate text-[12px]', r.status === 'overdue' ? 'font-semibold text-[var(--erp-red-text)]' : 'text-[var(--erp-muted)]')}>
                    {r.status === 'overdue' ? `${plural(r.days_overdue, 'day')} overdue` : r.due_date !== '' ? `Due ${listDay(r.due_date)}` : dayLabel(r.date)}
                  </span>
                </span>
                <span className="text-right">
                  <span className="num block text-[14px] font-bold">{money(r.balance, r.currency)}</span>
                  {r.balance !== r.total && <span className="num block text-[12px] text-[var(--erp-muted)]">of {money(r.total, r.currency)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentDocs({ p }: { p: PartyDetail }): React.JSX.Element {
  return (
    <Card delay={3}>
      <CardHeader title="Recent documents" icon={FileText} />
      {p.recent.length === 0 ? (
        <Empty icon={FileText} title="No documents yet" compact />
      ) : (
        <ul className="flex flex-col">
          {p.recent.map((r) => {
            const st = docStatus(r.state === 'posted' && (r.type === 'invoice' || r.type === 'bill') ? (r.balance <= 0 ? 'paid' : 'unpaid') : r.state);
            return (
              <li key={r.id} className="border-t border-[var(--erp-line)] first:border-t-0">
                <button type="button" onClick={() => openDoc(r.id)} className="flex w-full items-center gap-3 rounded-[14px] px-2 py-2.5 text-left hover:bg-[var(--erp-row)]">
                  <span className="w-24 shrink-0 text-[12px] font-semibold text-[var(--erp-muted)]">{SHORT_TYPE[r.type]}</span>
                  <span className="num min-w-0 flex-1 truncate text-[14px] font-semibold">{r.number !== '' ? r.number : 'Draft'}</span>
                  <span className="hidden w-20 shrink-0 text-[13px] text-[var(--erp-ink-2)] @min-[480px]:block">{listDay(r.date)}</span>
                  <span className="num w-28 shrink-0 text-right text-[14px] font-semibold">{r.type === 'delivery' || r.type === 'goods_receipt' ? '' : money(r.total, r.currency)}</span>
                  <span className="hidden w-28 shrink-0 justify-end @min-[480px]:flex">
                    <StatusPill tone={st.tone} size="sm">
                      {st.label}
                    </StatusPill>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- statement */

function StatementCard({ p, side, setSide }: { p: PartyDetail; side: Side; setSide: (s: Side) => void }): React.JSX.Element {
  const [range, setRange] = useState<{ from: string; to: string }>(() => ({ from: `${addMonths(today().slice(0, 7), -2)}-01`, to: today() }));
  const st = useLive(
    () => op<Statement>('parties.statement', { party: p.id, side, from: range.from !== '' ? range.from : undefined, to: range.to !== '' ? range.to : undefined }, { quiet: true }),
    ['journal_lines', 'journals'],
    [p.id, side, range.from, range.to],
  );
  const s = st.data;
  const csv = (): void => {
    if (s === null) return;
    const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = [
      ['Date', 'What', 'Journal', 'Amount', 'Balance'],
      [s.from, 'Opening balance', '', '', amount(s.opening, s.currency)],
      ...s.lines.map((l) => [l.date, l.label !== '' ? l.label : l.memo, l.journal, amount(l.amount, s.currency).replace(/,/g, ''), amount(l.balance, s.currency).replace(/,/g, '')]),
      [s.to, 'Closing balance', '', '', amount(s.closing, s.currency).replace(/,/g, '')],
    ];
    saveText(rows.map((r) => r.map((c) => esc(String(c).replace('−', '-'))).join(',')).join('\n'), `Statement ${p.name} ${s.from} to ${s.to}.csv`);
  };
  const open = (entity: string, id: string): void => {
    if (entity === 'documents') navigate('doc', { id });
    else if (entity === 'payments') navigate('payment', { id });
  };
  return (
    <Card delay={3} className="erp-print relative z-10" id="statement">
      <div className="erp-print-only mb-6">
        <p className="text-[15px] font-bold">{s?.company ?? ''}</p>
        <p className="text-[26px] font-bold">Statement of account</p>
        <p className="text-[13px]">
          {p.name} · {s !== null ? `${dayLabel(s.from)} to ${dayLabel(s.to)}` : ''}
        </p>
      </div>
      <div className="erp-no-print">
        <CardHeader
          title="Statement"
          subtitle={s !== null ? `${dayLabel(s.from)} to ${dayLabel(s.to)}` : undefined}
          icon={ScrollText}
          action={
            <div className="flex items-center gap-1">
              <CircleButton icon={Printer} label="Print the statement" variant="row" size={36} onClick={() => window.print()} disabled={s === null} />
              <CircleButton icon={Download} label="Save as CSV" variant="row" size={36} onClick={csv} disabled={s === null} />
            </div>
          }
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {p.is_customer && p.is_supplier && (
            <Segmented
              ariaLabel="Which account"
              value={side}
              onChange={setSide}
              options={[
                { value: 'receivable', label: 'Receivable' },
                { value: 'payable', label: 'Payable' },
              ]}
            />
          )}
          <DateRangeButton value={range} onChange={setRange} onCard />
        </div>
      </div>
      {s === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[480px] text-[13px]">
            <thead>
              <tr className="text-left text-[12px] font-semibold text-[var(--erp-muted)]">
                <th className="pb-2 pr-3 font-semibold">Date</th>
                <th className="pb-2 pr-3 font-semibold">What</th>
                <th className="pb-2 pr-3 text-right font-semibold">Amount</th>
                <th className="pb-2 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--erp-line)]">
                <td className="py-2 pr-3 text-[var(--erp-muted)]">{listDay(s.from)}</td>
                <td className="py-2 pr-3 font-semibold">Opening balance</td>
                <td />
                <td className="num py-2 text-right font-semibold">{money(s.opening, s.currency)}</td>
              </tr>
              {s.lines.map((l, i) => (
                <tr key={i} className="border-t border-[var(--erp-line)]">
                  <td className="num py-2 pr-3 text-[var(--erp-ink-2)]">{listDay(l.date)}</td>
                  <td className="py-2 pr-3">
                    {l.entity === 'documents' || l.entity === 'payments' ? (
                      <button type="button" onClick={() => open(l.entity, l.source)} className="text-left font-semibold underline-offset-4 hover:underline">
                        {l.label !== '' ? l.label : l.memo}
                      </button>
                    ) : (
                      <span className="font-semibold">{l.label !== '' ? l.label : l.memo}</span>
                    )}
                  </td>
                  <td className={cn('num py-2 pr-3 text-right', l.amount < 0 && 'text-[var(--erp-green-text)]')}>{money(l.amount, s.currency)}</td>
                  <td className="num py-2 text-right">{money(l.balance, s.currency)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--erp-ink)]">
                <td className="py-2.5 pr-3 text-[var(--erp-muted)]">{listDay(s.to)}</td>
                <td className="py-2.5 pr-3 font-bold">{side === 'receivable' ? 'They owe you' : 'You owe them'}</td>
                <td />
                <td className="num py-2.5 text-right text-[15px] font-bold">{money(s.closing, s.currency)}</td>
              </tr>
            </tbody>
          </table>
          {s.lines.length === 0 && <p className="mt-3 text-[13px] text-[var(--erp-muted)]">Nothing happened in these dates.</p>}
        </div>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------- right side */

function SummaryCard({ p }: { p: PartyDetail }): React.JSX.Element {
  const cur = p.base_currency;
  return (
    <Card tone="dark" delay={1}>
      <div className="grid grid-cols-2 gap-5">
        {p.is_customer && <Figure label="Sales this year" value={money(p.sales_this_year, cur, 'short')} />}
        {p.is_supplier && <Figure label="Bought this year" value={money(p.purchases_this_year, cur, 'short')} />}
        <Figure label="Last activity" value={p.last_activity !== '' ? dayLabel(p.last_activity) : 'None yet'} size="md" />
        <Figure label={p.is_customer ? 'Open orders and quotes' : 'Open orders'} value={qty(p.open.orders + (p.is_customer ? p.open.quotes : 0))} size="md" />
      </div>
    </Card>
  );
}

function DetailsCard({ p, onEdit, canEdit }: { p: PartyDetail; onEdit: () => void; canEdit: boolean }): React.JSX.Element {
  const rows: [string, React.ReactNode][] = [];
  if (p.email !== '')
    rows.push([
      'Email',
      <a key="e" href={`mailto:${p.email}`} className="inline-flex items-center gap-1.5 font-semibold underline-offset-4 hover:underline">
        <Mail size={13} aria-hidden /> {p.email}
      </a>,
    ]);
  if (p.phone !== '')
    rows.push([
      'Phone',
      <a key="p" href={`tel:${p.phone}`} className="num inline-flex items-center gap-1.5 font-semibold underline-offset-4 hover:underline">
        <Phone size={13} aria-hidden /> {p.phone}
      </a>,
    ]);
  if (p.website !== '') rows.push(['Website', p.website]);
  if (p.tax_id !== '') rows.push(['Tax number', p.tax_id]);
  rows.push(['Payment terms', p.terms?.name ?? (p.effective_terms !== null ? `${p.effective_terms.name} (default)` : 'Company default')]);
  rows.push(['Currency', p.currency !== '' ? p.currency : `${p.base_currency} (base)`]);
  if (p.is_customer) rows.push(['Credit limit', p.credit_limit > 0 ? money(p.credit_limit, p.base_currency) : 'None']);
  if (p.is_customer) rows.push(['Sales tax', p.sale_tax?.name ?? (p.effective_sale_tax !== null ? `${p.effective_sale_tax.name} (default)` : 'None')]);
  if (p.is_supplier) rows.push(['Purchase tax', p.purchase_tax?.name ?? (p.effective_purchase_tax !== null ? `${p.effective_purchase_tax.name} (default)` : 'None')]);
  return (
    <Card delay={2}>
      <CardHeader title="Details" action={canEdit ? <CircleButton icon={Pencil} label="Edit the details" variant="row" size={36} onClick={onEdit} /> : undefined} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[var(--erp-muted)]">{k}</dt>
            <dd className="min-w-0 truncate text-right font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {(p.billing_address !== '' || p.shipping_address !== '') && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {p.billing_address !== '' && (
            <div className="rounded-[16px] bg-[var(--erp-row)] px-3 py-2.5 text-[13px] leading-5">
              <p className="mb-0.5 text-[12px] font-semibold text-[var(--erp-muted)]">Billing</p>
              <p className="whitespace-pre-line">{p.billing_address}</p>
            </div>
          )}
          {p.shipping_address !== '' && p.shipping_address !== p.billing_address && (
            <div className="rounded-[16px] bg-[var(--erp-row)] px-3 py-2.5 text-[13px] leading-5">
              <p className="mb-0.5 text-[12px] font-semibold text-[var(--erp-muted)]">Shipping</p>
              <p className="whitespace-pre-line">{p.shipping_address}</p>
            </div>
          )}
        </div>
      )}
      {p.notes !== '' && <p className="mt-4 whitespace-pre-line rounded-[16px] bg-[var(--erp-row)] px-3 py-2.5 text-[13px] leading-5">{p.notes}</p>}
    </Card>
  );
}

function ContactsCard({ p, canEdit, onChanged }: { p: PartyDetail; canEdit: boolean; onChanged: () => void }): React.JSX.Element {
  const [editing, setEditing] = useState<PartyContact | null | 'new'>(null);
  const [confirmEl, confirm] = useConfirm();
  const remove = async (c: PartyContact): Promise<void> => {
    if (!(await confirm(`${c.name} is removed from ${p.name}.`, 'Remove this contact?', 'Remove'))) return;
    try {
      await op('contacts.delete', { contact: c.id });
      toast.success('Contact removed');
      onChanged();
    } catch {
      /* shown */
    }
  };
  return (
    <Card delay={3}>
      <CardHeader title="Contacts" subtitle={p.contacts.length > 0 ? plural(p.contacts.length, 'person', 'people') : undefined} icon={Users} action={canEdit ? <CircleButton icon={UserPlus} label="Add a contact" variant="row" size={36} onClick={() => setEditing('new')} /> : undefined} />
      {p.contacts.length === 0 ? (
        <Empty icon={Users} title="No contacts yet" compact action={canEdit ? <PillButton variant="soft" size="sm" icon={Plus} onClick={() => setEditing('new')}>Add a contact</PillButton> : undefined} />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {p.contacts.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2.5">
              <Avatar name={c.name} size={36} tone="card" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-bold">{c.name}</span>
                  {c.primary && (
                    <StatusPill tone="accent" size="sm">
                      Main
                    </StatusPill>
                  )}
                </span>
                <span className="block truncate text-[12px] text-[var(--erp-muted)]">{[c.title, c.email, c.phone].filter((x) => x !== '').join(' · ') || 'No details'}</span>
              </span>
              {canEdit && (
                <span className="flex shrink-0 gap-1">
                  <CircleButton icon={Pencil} label={`Edit ${c.name}`} variant="ghost" size={32} onClick={() => setEditing(c)} />
                  <CircleButton icon={Trash2} label={`Remove ${c.name}`} variant="ghost" size={32} onClick={() => void remove(c)} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <ContactForm open={editing !== null} onClose={() => setEditing(null)} partyId={p.id} contact={editing === 'new' ? null : editing} onSaved={onChanged} />
      {confirmEl}
    </Card>
  );
}

function MoneyCard({ p }: { p: PartyDetail }): React.JSX.Element {
  const me = useMe();
  const dir = p.is_customer ? 'in' : 'out';
  // Payments in need Banking or Sales to see; payments out, Banking or Purchasing.
  const canSeePays = can(me, 'banking', 'view') || can(me, dir === 'in' ? 'sales' : 'purchasing', 'view');
  const pays = useLive(() => (canSeePays ? op<{ payments: PaymentRow[] }>('payments.list', { direction: dir, party: p.id, limit: 5 }, { quiet: true }).catch(() => null) : Promise.resolve(null)), READS.money, [p.id, dir, canSeePays]);
  const rows = pays.data?.payments ?? [];
  const canRecord = canPay(me, p.is_customer ? 'sales' : 'purchase');
  return (
    <Card delay={3}>
      <CardHeader
        title="Payments and credits"
        icon={CreditCard}
        action={
          canRecord ? (
            <PillButton variant="soft" size="sm" icon={Plus} onClick={() => navigate('payments', { new: dir, party: p.id })}>
              {dir === 'in' ? 'Money in' : 'Money out'}
            </PillButton>
          ) : undefined
        }
      />
      {p.unallocated.length > 0 && (
        <div className="mb-3 flex flex-col gap-1.5">
          {p.unallocated.map((u) => (
            <button key={u.id} type="button" onClick={() => navigate('payment', { id: u.id })} className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--erp-amber)]/20 px-3 py-2.5 text-left">
              <span className="min-w-0 flex-1">
                <span className="num block text-[13px] font-bold">{u.number}</span>
                <span className="block text-[12px] text-[var(--erp-amber-text)]">Not applied to a document yet</span>
              </span>
              <span className="num text-[13px] font-bold">{money(u.unallocated, u.currency)}</span>
            </button>
          ))}
        </div>
      )}
      {pays.data === null && pays.loading ? (
        <Skeleton className="h-12" />
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-[var(--erp-muted)]">{!canSeePays ? 'Payments show to people with Banking access.' : 'No payments yet.'}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.id} className="border-t border-[var(--erp-line)] first:border-t-0">
              <button type="button" onClick={() => navigate('payment', { id: r.id })} className="flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left hover:bg-[var(--erp-row)]">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--erp-row)]">{dir === 'in' ? <ArrowDownLeft size={14} aria-hidden /> : <ArrowUpRight size={14} aria-hidden />}</span>
                <span className="min-w-0 flex-1">
                  <span className="num block truncate text-[13px] font-bold">{r.number !== '' ? r.number : 'Draft'}</span>
                  <span className="block truncate text-[12px] text-[var(--erp-muted)]">{dayLabel(r.date)}</span>
                </span>
                <span className="num text-[13px] font-bold">{money(r.amount, r.currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export function PartyPage({ query }: PageProps): React.JSX.Element {
  const id = query.get('id') ?? '';
  const me = useMe();
  const live = useLive(() => op<PartyDetail>('parties.get', { party: id }, { quiet: true }), ['parties', 'contacts', 'journal_lines', ...READS.docs], [id]);
  const p = live.data;
  const roleParam = query.get('role');
  const listPage = p !== null ? (p.is_customer && (roleParam !== 'supplier' || !p.is_supplier) ? 'customers' : 'suppliers') : roleParam === 'supplier' ? 'suppliers' : 'customers';
  useSection('party', p !== null ? listPage : null);
  const [sideState, setSide] = useState<Side | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const side: Side = sideState ?? (p !== null && !p.is_customer ? 'payable' : roleParam === 'supplier' && p?.is_supplier === true ? 'payable' : 'receivable');

  const canEdit = p !== null && p.can.edit && (p.is_customer ? can(me, 'sales', 'edit') : true) && (p.is_supplier ? can(me, 'purchasing', 'edit') : true);
  const canSell = can(me, 'sales', 'edit');
  const canBuy = can(me, 'purchasing', 'edit');
  const menu = useMemo(() => {
    if (p === null) return [];
    return [
      { label: 'Edit details', icon: Pencil, hidden: !canEdit, onClick: () => setEditing(true) },
      { label: 'New quote', icon: FileText, hidden: !(p.is_customer && canSell), onClick: () => navigate('doc-new', { type: 'quote', party: p.id }) },
      { label: 'New sales order', icon: FileText, hidden: !(p.is_customer && canSell), onClick: () => navigate('doc-new', { type: 'sales_order', party: p.id }) },
      { label: 'New credit note', icon: FileText, hidden: !(p.is_customer && canSell), onClick: () => navigate('doc-new', { type: 'credit_note', party: p.id }) },
      { label: 'New invoice', icon: ReceiptText, hidden: !(p.is_customer && p.is_supplier && canSell && listPage === 'suppliers'), onClick: () => navigate('doc-new', { type: 'invoice', party: p.id }) },
      { label: 'New purchase order', icon: FileText, hidden: !(p.is_supplier && canBuy), onClick: () => navigate('doc-new', { type: 'purchase_order', party: p.id }) },
      { label: 'New bill', icon: ReceiptText, hidden: !(p.is_supplier && canBuy && listPage === 'customers'), onClick: () => navigate('doc-new', { type: 'bill', party: p.id }) },
      { label: 'Print the statement', icon: Printer, onClick: () => window.print() },
      { label: 'Restore', icon: RotateCcw, hidden: !(canEdit && p.archived), onClick: () => void op('parties.update', { party: p.id, archived: false }).then(() => toast.success('Restored')).catch(() => undefined) },
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        hidden: !canEdit,
        onClick: () =>
          void (async () => {
            try {
              await op('parties.delete', { party: p.id, preview: true });
            } catch {
              return;
            }
            if (!(await confirm(`${p.name} has no history and is deleted for good.`, `Delete ${p.name}?`))) return;
            try {
              await op('parties.delete', { party: p.id });
              toast.success('Deleted');
              navigate(listPage);
            } catch {
              /* shown */
            }
          })(),
      },
    ];
  }, [p, canEdit, canSell, canBuy, listPage, confirm]);

  if (p === null) {
    if (live.error !== null) {
      return (
        <>
          <PageHeader title="Customer or supplier" back={() => back(listPage)} />
          <LoadError message={live.error} onRetry={live.reload} />
        </>
      );
    }
    return <PageSkeleton rows={6} />;
  }

  const sells = p.is_customer && canSell && (listPage === 'customers' || !p.is_supplier);
  const buys = p.is_supplier && canBuy && !sells;

  return (
    <>
      <div className="relative z-30">
      <PageHeader
        back={() => back(listPage)}
        eyebrow={
          <>
            {p.is_customer && (
              <StatusPill tone="neutral" size="sm">
                Customer
              </StatusPill>
            )}
            {p.is_supplier && (
              <StatusPill tone="neutral" size="sm">
                Supplier
              </StatusPill>
            )}
            {p.archived && (
              <StatusPill tone="warn" size="sm">
                Archived
              </StatusPill>
            )}
          </>
        }
        title={
          <span className="flex min-w-0 items-center gap-3">
            <Avatar name={p.name} size={44} tone="ink" />
            <span className="min-w-0 break-words">{p.name}</span>
          </span>
        }
        subtitle={[p.code, p.contact_name, p.email].filter((x) => x !== '').join(' · ')}
        actions={
          <>
            {sells && (
              <PillButton icon={Plus} dot onClick={() => navigate('doc-new', { type: 'invoice', party: p.id })}>
                New invoice
              </PillButton>
            )}
            {buys && (
              <PillButton icon={Plus} dot onClick={() => navigate('doc-new', { type: 'bill', party: p.id })}>
                New bill
              </PillButton>
            )}
            <Menu items={menu} />
          </>
        }
      />
      </div>

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <div className="flex min-w-0 flex-col gap-5 @min-[900px]:col-span-8">
          <BalanceCard p={p} side={side} setSide={setSide} />
          <MonthsCard p={p} />
          <OpenDocs p={p} />
          <StatementCard p={p} side={side} setSide={setSide} />
          <RecentDocs p={p} />
        </div>
        <div className="flex min-w-0 flex-col gap-5 @min-[900px]:col-span-4">
          <SummaryCard p={p} />
          <DetailsCard p={p} canEdit={canEdit} onEdit={() => setEditing(true)} />
          <ContactsCard p={p} canEdit={canEdit} onChanged={live.reload} />
          <MoneyCard p={p} />
          <RecordActivity entity="parties" refId={p.id} />
        </div>
      </div>

      <PartyForm open={editing} onClose={() => setEditing(false)} party={p} role={p.is_customer ? 'customer' : 'supplier'} base={p.base_currency} onSaved={(r) => live.set(r)} />
      {confirmEl}
    </>
  );
}
