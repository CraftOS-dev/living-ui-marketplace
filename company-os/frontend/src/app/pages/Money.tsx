/**
 * Money: one verdict number (cash) with the runway as a plain sentence
 * (Mercury/Runway.com), month-grouped ledger rows with signed tabular
 * amounts, and invoices whose badge is computed from due date (Stripe's
 * dynamic "Past due"). Still deliberately NOT an accounting engine.
 */
import { useState } from 'react';
import { CircleDollarSign, Plus, Printer, ReceiptText, ScrollText } from 'lucide-react';
import {
  Button,
  Dialog,
  EntityForm,
  NumberInput,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  getPbClient,
  toast,
  useCollection,
  useConfirm,
} from '../../kit/index.ts';
import type { EntityField } from '../../kit/index.ts';
import type { Company, Customer, Invoice, MoneyEntry } from '../lib/types.ts';
import {
  DeleteButton,
  EditButton,
  ExportMenu,
  GhostRows,
  GhostState,
  GroupHeader,
  IdentityChip,
  ListRow,
  MoneyAmount,
  PageHeader,
  Pill,
  RelDate,
  StatTile,
  fmtMoney,
  relDay,
  type Tone,
} from '../components/ui.tsx';
import { downloadCsv, escapeHtml, printDocument, reportMasthead, stampedName } from '../lib/export.ts';
import { todayStr } from '../lib/useCompany.ts';

const ENTRY_FIELDS: EntityField[] = [
  {
    name: 'kind',
    label: 'Direction',
    type: 'select',
    required: true,
    options: [
      { value: 'in', label: 'Money in' },
      { value: 'out', label: 'Money out' },
    ],
  },
  { name: 'amount', type: 'number', required: true },
  { name: 'category', type: 'text', placeholder: 'e.g. Sales, Rent, Supplies' },
  { name: 'date', type: 'date', required: true },
  { name: 'note', type: 'textarea' },
];

const INVOICE_FIELDS: EntityField[] = [
  { name: 'number', label: 'Invoice number', type: 'text', required: true },
  { name: 'customer', type: 'ref', ref: { collection: 'customers', labelField: 'name' } },
  { name: 'amount', type: 'number', required: true },
  {
    name: 'status',
    type: 'select',
    required: true,
    options: [
      { value: 'draft', label: 'Draft' },
      { value: 'sent', label: 'Sent' },
      { value: 'paid', label: 'Paid' },
    ],
  },
  { name: 'issued', type: 'date' },
  { name: 'due', type: 'date' },
  { name: 'note', type: 'textarea' },
];

/** Stripe-style dynamic badge: the label reflects the ACTION state. */
function invoiceBadge(inv: Invoice): { label: string; tone: Tone } {
  if (inv.status === 'paid') return { label: 'Paid', tone: 'good' };
  if (inv.status === 'draft') return { label: 'Draft', tone: 'neutral' };
  if (inv.due !== '' && relDay(inv.due).overdue) return { label: 'Past due', tone: 'bad' };
  return { label: 'Sent', tone: 'info' };
}

export function MoneyPage({ company }: { company: Company }): React.JSX.Element {
  const { records: entries } = useCollection<MoneyEntry>('money_entries', { sort: '-date' });
  const { records: customers } = useCollection<Customer>('customers');
  const [entryOpen, setEntryOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [cashDraft, setCashDraft] = useState<number | null>(null);
  const [cashEditing, setCashEditing] = useState(false);
  const [confirmEl, confirm] = useConfirm();

  const month = todayStr().slice(0, 7);
  let inMonth = 0;
  let outMonth = 0;
  for (const e of entries) {
    if (e.date.slice(0, 7) === month) {
      if (e.kind === 'in') inMonth += e.amount;
      else outMonth += e.amount;
    }
  }

  // Runway from the last 90 days.
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  let net90 = 0;
  for (const e of entries) {
    if (e.date.slice(0, 10) >= since) net90 += e.kind === 'in' ? e.amount : -e.amount;
  }
  const monthlyNet = net90 / 3;
  const runwayMonths = company.cash_on_hand > 0 && monthlyNet < 0 ? company.cash_on_hand / -monthlyNet : null;
  let runwaySentence: string;
  if (entries.length === 0) {
    runwaySentence = 'Record money in and out and the runway appears here.';
  } else if (runwayMonths !== null) {
    const until = new Date(Date.now() + runwayMonths * 30.4 * 24 * 3600 * 1000);
    runwaySentence = `At the current pace (about ${fmtMoney(Math.round(-monthlyNet))}/month net out), cash lasts roughly ${runwayMonths.toFixed(1)} months, until ${until.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}.`;
  } else {
    runwaySentence = 'You are bringing in more than you spend. Runway is not a worry right now.';
  }

  // Ledger grouped by month, newest first.
  const byMonth = new Map<string, MoneyEntry[]>();
  for (const e of entries) {
    const m = e.date.slice(0, 7);
    const list = byMonth.get(m);
    if (list !== undefined) list.push(e);
    else byMonth.set(m, [e]);
  }
  const monthKeys = [...byMonth.keys()].sort((a, b) => (a > b ? -1 : 1));
  const monthLabel = (m: string): string =>
    new Date(m + '-15T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const saveCash = async (): Promise<void> => {
    if (cashDraft === null) return;
    try {
      await getPbClient().call((pb) => pb.collection('company').update(company.id, { cash_on_hand: cashDraft }));
      setCashDraft(null);
      setCashEditing(false);
      toast.success('Cash on hand updated');
    } catch {
      /* surfaced by shell */
    }
  };

  const deleteEntry = async (e: MoneyEntry): Promise<void> => {
    if (!(await confirm('Delete this entry?'))) return;
    await getPbClient()
      .call((pb) => pb.collection('money_entries').delete(e.id))
      .catch(() => undefined);
  };

  const recordInvoiceIncome = async (invoice: Invoice): Promise<void> => {
    try {
      await getPbClient().call((pb) =>
        pb.collection('money_entries').create({
          kind: 'in',
          amount: invoice.amount,
          category: 'Sales',
          note: `Invoice ${invoice.number}`,
          date: todayStr(),
        }),
      );
      await getPbClient().call((pb) => pb.collection('invoices').update(invoice.id, { recorded: true }));
      toast.success('Recorded as money in');
    } catch {
      /* surfaced by shell */
    }
  };

  const setInvoiceStatus = async (invoice: Invoice, status: Invoice['status']): Promise<void> => {
    await getPbClient()
      .call((pb) => pb.collection('invoices').update(invoice.id, { status }))
      .catch(() => undefined);
  };

  const deleteInvoice = async (invoice: Invoice): Promise<void> => {
    if (!(await confirm(`Delete invoice #${invoice.number}?`))) return;
    await getPbClient()
      .call((pb) => pb.collection('invoices').delete(invoice.id))
      .catch(() => undefined);
  };

  const { records: invoices } = useCollection<Invoice>('invoices', { sort: '-created' });
  const customerName = (id: string): string => customers.find((c) => c.id === id)?.name ?? '';

  /* ---------- Exports ---------- */

  // Two-column ("double") ledger: every entry with In / Out side by side and a
  // totals row — the file an accountant or spreadsheet expects.
  const exportLedgerCsv = (): void => {
    const chronological = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
    const rows = chronological.map((e) => [
      e.date.slice(0, 10),
      e.category,
      e.note,
      e.kind === 'in' ? e.amount : '',
      e.kind === 'out' ? e.amount : '',
    ]);
    const totalIn = entries.filter((e) => e.kind === 'in').reduce((s, e) => s + e.amount, 0);
    const totalOut = entries.filter((e) => e.kind === 'out').reduce((s, e) => s + e.amount, 0);
    rows.push(['', '', 'Totals', totalIn, totalOut]);
    downloadCsv(stampedName(`${company.name}-ledger`, 'csv'), ['Date', 'Category', 'Note', 'Money in', 'Money out'], rows);
  };

  const exportFinancialSummary = (): void => {
    const netMonth = inMonth - outMonth;
    const monthRows = monthKeys
      .map((m) => {
        const list = byMonth.get(m) ?? [];
        const mi = list.filter((e) => e.kind === 'in').reduce((s, e) => s + e.amount, 0);
        const mo = list.filter((e) => e.kind === 'out').reduce((s, e) => s + e.amount, 0);
        const net = mi - mo;
        return `<tr><td>${escapeHtml(monthLabel(m))}</td><td class="num pos">${fmtMoney(mi)}</td><td class="num">${fmtMoney(mo)}</td><td class="num ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${fmtMoney(net)}</td></tr>`;
      })
      .join('');
    const totIn = entries.filter((e) => e.kind === 'in').reduce((s, e) => s + e.amount, 0);
    const totOut = entries.filter((e) => e.kind === 'out').reduce((s, e) => s + e.amount, 0);
    const totNet = totIn - totOut;

    const unpaid = invoices.filter((i) => i.status !== 'paid');
    const unpaidTotal = unpaid.reduce((s, i) => s + i.amount, 0);
    const overdue = unpaid.filter((i) => i.due !== '' && relDay(i.due).overdue).length;

    const kpis = `<div class="kpis">
      <div class="kpi"><div class="label">Cash on hand</div><div class="value">${fmtMoney(company.cash_on_hand)}</div></div>
      <div class="kpi"><div class="label">In this month</div><div class="value pos">${fmtMoney(inMonth)}</div></div>
      <div class="kpi"><div class="label">Out this month</div><div class="value">${fmtMoney(outMonth)}</div></div>
      <div class="kpi"><div class="label">Net this month</div><div class="value ${netMonth >= 0 ? 'pos' : 'neg'}">${netMonth >= 0 ? '+' : ''}${fmtMoney(netMonth)}</div></div>
    </div>`;

    const monthTable =
      monthKeys.length > 0
        ? `<h2>Month by month</h2><table><thead><tr><th>Month</th><th class="num">In</th><th class="num">Out</th><th class="num">Net</th></tr></thead><tbody>${monthRows}<tr class="total"><td>All time</td><td class="num">${fmtMoney(totIn)}</td><td class="num">${fmtMoney(totOut)}</td><td class="num">${totNet >= 0 ? '+' : ''}${fmtMoney(totNet)}</td></tr></tbody></table>`
        : '';

    const invoiceBlock =
      invoices.length > 0
        ? `<h2>Invoices outstanding</h2><div class="row"><span>${unpaid.length} unpaid invoice${unpaid.length === 1 ? '' : 's'}${overdue > 0 ? ` · ${overdue} past due` : ''}</span><span class="num">${fmtMoney(unpaidTotal)}</span></div>`
        : '';

    const body =
      reportMasthead(company.name, 'Financial Summary') +
      kpis +
      `<p class="note muted">${escapeHtml(runwaySentence)}</p>` +
      monthTable +
      invoiceBlock +
      `<p class="foot">Company OS · a plain record of money in and out. Not an accounting or tax document.</p>`;

    printDocument(`${company.name} — Financial Summary`, body);
  };

  const exportInvoicePdf = (inv: Invoice): void => {
    const cname = customerName(inv.customer);
    const badge = invoiceBadge(inv);
    const fmtDate = (iso: string): string =>
      iso === ''
        ? '—'
        : new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
    const body =
      reportMasthead(company.name, `Invoice #${inv.number}`) +
      `<div class="kpis">
        <div class="kpi"><div class="label">Amount</div><div class="value">${fmtMoney(inv.amount)}</div><div class="sub">${escapeHtml(badge.label)}</div></div>
        <div class="kpi"><div class="label">Issued</div><div class="value" style="font-size:14px">${escapeHtml(fmtDate(inv.issued))}</div></div>
        <div class="kpi"><div class="label">Due</div><div class="value" style="font-size:14px">${escapeHtml(fmtDate(inv.due))}</div></div>
      </div>` +
      `<h2>Bill to</h2><p class="note">${cname !== '' ? escapeHtml(cname) : '<span class="muted">No customer set</span>'}</p>` +
      `<h2>Details</h2><table><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody>` +
      `<tr><td>${inv.note !== '' ? escapeHtml(inv.note) : `Invoice #${escapeHtml(inv.number)}`}</td><td class="num">${fmtMoney(inv.amount)}</td></tr>` +
      `<tr class="total"><td>Total</td><td class="num">${fmtMoney(inv.amount)}</td></tr>` +
      `</tbody></table>` +
      `<p class="foot">Generated by Company OS.</p>`;
    printDocument(`Invoice ${inv.number} — ${company.name}`, body);
  };

  return (
    <div>
      <PageHeader
        icon={CircleDollarSign}
        title="Money"
        subtitle="A simple record of money in and out. Not an accounting or tax tool."
        actions={
          <>
            <ExportMenu
              disabled={entries.length === 0 && invoices.length === 0}
              items={[
                { label: 'Ledger (CSV)', icon: <ScrollText size={14} aria-hidden />, onSelect: exportLedgerCsv, disabled: entries.length === 0 },
                { label: 'Financial summary (PDF)', icon: <CircleDollarSign size={14} aria-hidden />, onSelect: exportFinancialSummary },
              ]}
            />
            <Button size="sm" onClick={() => setEntryOpen(true)}>
              <Plus size={14} aria-hidden />
              Add entry
            </Button>
          </>
        }
      />

      {/* Verdict block */}
      <div className="mb-3 border border-[var(--lui-border)] bg-[var(--lui-surface)] px-5 py-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--lui-muted)]">Cash on hand</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className="text-[32px] font-semibold leading-9 tracking-tight tabular-nums">
            {fmtMoney(company.cash_on_hand)}
          </span>
          {!cashEditing ? (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setCashEditing(true)}>
              Update
            </Button>
          ) : (
            <span className="flex items-end gap-1.5">
              <NumberInput label="" value={cashDraft} onValue={setCashDraft} placeholder={String(company.cash_on_hand)} />
              <Button size="sm" variant="secondary" disabled={cashDraft === null} onClick={() => void saveCash()}>
                Set
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCashEditing(false)}>
                Cancel
              </Button>
            </span>
          )}
        </div>
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-[var(--lui-muted)]">{runwaySentence}</p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="In this month" value={fmtMoney(inMonth)} tone="good" sub="money in" />
        <StatTile label="Out this month" value={fmtMoney(outMonth)} tone={outMonth > inMonth ? 'warn' : 'neutral'} sub="money out" />
        <StatTile
          label="Net this month"
          value={`${inMonth - outMonth >= 0 ? '+' : ''}${fmtMoney(inMonth - outMonth)}`}
          tone={inMonth - outMonth >= 0 ? 'good' : 'bad'}
          sub="in minus out"
        />
      </div>

      <Tabs defaultValue="ledger">
        <TabsList className="mb-3">
          <TabsTrigger value="ledger" className="inline-flex items-center gap-1.5">
            <ScrollText size={14} aria-hidden />
            Ledger
          </TabsTrigger>
          <TabsTrigger value="invoices" className="inline-flex items-center gap-1.5">
            <ReceiptText size={14} aria-hidden />
            Invoices
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ledger">
          {entries.length === 0 ? (
            <GhostState
              icon={CircleDollarSign}
              title="No money recorded yet"
              message="Record what comes in and what goes out. A few entries are enough for the monthly summary and your runway."
              action={<Button onClick={() => setEntryOpen(true)}>Add your first entry</Button>}
            >
              <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
                <GhostRows rows={4} chip={false} />
              </div>
            </GhostState>
          ) : (
            <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
              {monthKeys.map((m) => {
                const list = byMonth.get(m) ?? [];
                const net = list.reduce((s, e) => s + (e.kind === 'in' ? e.amount : -e.amount), 0);
                return (
                  <div key={m}>
                    <GroupHeader
                      label={monthLabel(m)}
                      count={list.length}
                      right={
                        <span className="text-[11px] tabular-nums text-[var(--lui-muted)]">
                          net {net >= 0 ? '+' : ''}
                          {fmtMoney(net)}
                        </span>
                      }
                    />
                    {list.map((e) => (
                      <ListRow
                        key={e.id}
                        primary={<span className="text-[13px] font-normal">{e.note !== '' ? e.note : e.category !== '' ? e.category : e.kind === 'in' ? 'Money in' : 'Money out'}</span>}
                        secondary={
                          e.category !== '' && e.note !== '' ? e.category : undefined
                        }
                        trailing={
                          <>
                            <span className="hidden text-xs tabular-nums text-[var(--lui-muted)] sm:inline">
                              {new Date(e.date.slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                            <MoneyAmount amount={e.amount} kind={e.kind} className="w-24" />
                          </>
                        }
                        hoverActions={<DeleteButton onClick={() => void deleteEntry(e)} />}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="invoices">
          <div className="mb-3 flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditingInvoice(null);
                setInvoiceOpen(true);
              }}
            >
              <Plus size={14} aria-hidden />
              New invoice
            </Button>
          </div>
          {invoices.length === 0 ? (
            <GhostState
              icon={ReceiptText}
              title="No invoices yet"
              message="Create one and mark it sent when it goes out. Paid invoices can be recorded as money in with one click."
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingInvoice(null);
                    setInvoiceOpen(true);
                  }}
                >
                  New invoice
                </Button>
              }
            >
              <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
                <GhostRows rows={3} />
              </div>
            </GhostState>
          ) : (
            <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
              {invoices.map((inv) => {
                const badge = invoiceBadge(inv);
                const cname = customerName(inv.customer);
                return (
                  <ListRow
                    key={inv.id}
                    leading={cname !== '' ? <IdentityChip name={cname} square /> : undefined}
                    primary={`#${inv.number}${cname !== '' ? ` · ${cname}` : ''}`}
                    secondary={inv.due !== '' && inv.status !== 'paid' ? undefined : undefined}
                    trailing={
                      <>
                        {inv.due !== '' && inv.status !== 'paid' && (
                          <span className="hidden items-center gap-1 text-xs text-[var(--lui-muted)] sm:flex">
                            due <RelDate iso={inv.due} />
                          </span>
                        )}
                        <span className="w-20 text-right text-sm font-medium tabular-nums">{fmtMoney(inv.amount)}</span>
                        <Pill tone={badge.tone}>{badge.label}</Pill>
                      </>
                    }
                    hoverActions={
                      <>
                        {inv.status === 'draft' && (
                          <Button size="sm" variant="ghost" onClick={() => void setInvoiceStatus(inv, 'sent')}>
                            Mark sent
                          </Button>
                        )}
                        {inv.status === 'sent' && (
                          <Button size="sm" variant="ghost" onClick={() => void setInvoiceStatus(inv, 'paid')}>
                            Mark paid
                          </Button>
                        )}
                        {inv.status === 'paid' && !inv.recorded && (
                          <Button size="sm" variant="ghost" onClick={() => void recordInvoiceIncome(inv)}>
                            Record income
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Save invoice as PDF"
                          title="Save as PDF"
                          onClick={() => exportInvoicePdf(inv)}
                          className="size-8 shrink-0 p-0 text-[var(--lui-muted)] hover:text-[var(--lui-text)]"
                        >
                          <Printer size={15} aria-hidden />
                        </Button>
                        <EditButton
                          onClick={() => {
                            setEditingInvoice(inv);
                            setInvoiceOpen(true);
                          }}
                        />
                        <DeleteButton onClick={() => void deleteInvoice(inv)} />
                      </>
                    }
                    onClick={() => {
                      setEditingInvoice(inv);
                      setInvoiceOpen(true);
                    }}
                  />
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {confirmEl}

      <Dialog open={entryOpen} onOpenChange={setEntryOpen} title="Add money entry">
        <EntityForm
          collection="money_entries"
          fields={ENTRY_FIELDS}
          defaults={{ kind: 'in', date: todayStr() }}
          onSaved={() => setEntryOpen(false)}
          onCancel={() => setEntryOpen(false)}
        />
      </Dialog>

      <Dialog
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        title={editingInvoice !== null ? 'Edit invoice' : 'New invoice'}
      >
        <EntityForm
          collection="invoices"
          fields={INVOICE_FIELDS}
          {...(editingInvoice !== null
            ? { initial: editingInvoice }
            : { defaults: { status: 'draft', issued: todayStr() } })}
          onSaved={() => setInvoiceOpen(false)}
          onCancel={() => setInvoiceOpen(false)}
        />
      </Dialog>
    </div>
  );
}
