/**
 * Sales (invoices, credit notes) and Purchases (bills, vendor credits).
 *
 * The list leads with what is owed and overdue. The editor drafts a
 * document line by line (account and tax per line); approving numbers it
 * and posts it through receivables or payables. Payments, credits and
 * write-offs settle it; the state (open, partial, overdue, paid) follows.
 * The AI agent drafts documents from what it reads and writes reminders;
 * the person approves.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowLeft, ArrowUpRight, Banknote, CalendarClock, Check as CheckIcon, CircleAlert, Clock, Copy, FileInput, FileOutput, FilePen, FileText, HandCoins, Mail, Plus, Printer, Receipt, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import type { DocInput } from '../lib/api.ts';
import { DOC_LABEL, ago, addDays, day, money, parseMoney, toDecimal, today } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { Doc, DocKind, DocState } from '../lib/types.ts';
import { AccountPicker, AiChip, ContactPicker, DateInput, Heading, KV, Money, MoneyInput, Stat, Tabs, TaxPicker, isCash } from '../components/controls.tsx';
import { AGE_BUCKETS, Meter } from '../components/charts.tsx';
import { Btn, Chip, Empty, Field, IconBtn, Menu, Modal, Select, Spinner, Toggle, area, input, useConfirm } from '../components/ui.tsx';

type Side = 'sales' | 'purchases';

const STATE_TONE: Record<DocState, 'neutral' | 'pos' | 'neg' | 'accent' | 'ink' | 'warn'> = {
  draft: 'neutral',
  open: 'ink',
  partial: 'warn',
  overdue: 'neg',
  paid: 'pos',
  applied: 'pos',
  void: 'neutral',
};

const STATE_LABEL: Record<DocState, string> = { draft: 'Draft', open: 'Open', partial: 'Part paid', overdue: 'Overdue', paid: 'Paid', applied: 'Applied', void: 'Void' };

export function StateChip({ d }: { d: Doc }): React.JSX.Element {
  return <Chip tone={STATE_TONE[d.state]}>{d.state === 'overdue' ? `Overdue ${d.days_overdue}d` : STATE_LABEL[d.state]}</Chip>;
}

/* ------------------------------------------------------------------ list */

function DocList({ side, q }: { side: Side; q: Record<string, string> }): React.JSX.Element {
  const app = useApp();
  const state = q['state'] ?? '';
  const [search, setSearch] = useState('');
  const live = useLive(() => api.docs({ side, state: state || undefined, q: search || undefined, limit: 1000 }), ['documents', 'allocations'], [side, state, search], 250);
  const docs = live.data?.docs ?? [];
  const sum = side === 'sales' ? app.summary?.receivables : app.summary?.payables;
  const aged = useLive(() => api.aged({ side: side === 'sales' ? 'receivables' : 'payables' }), ['documents', 'allocations'], [side], 400);
  const ageTotal = aged.data?.totals['total'] ?? 0;
  const setState = (v: string): void => setQuery({ state: v || undefined });
  const newKind: DocKind = side === 'sales' ? 'invoice' : 'bill';
  return (
    <div className="flex h-full min-h-0 flex-col">
      {sum !== undefined && (
        <div className="grid shrink-0 grid-cols-2 border-b border-[var(--lf-line)] sm:grid-cols-5">
          <Stat icon={side === 'sales' ? HandCoins : Receipt} label={side === 'sales' ? 'Customers owe you' : 'You owe suppliers'} onClick={() => setState('unpaid')} active={state === 'unpaid'}>
            {money(sum.open, app.home)}
          </Stat>
          <Stat icon={CircleAlert} label="Overdue" tone={sum.overdue > 0 ? 'neg' : 'none'} onClick={() => setState('overdue')} active={state === 'overdue'}>
            {money(sum.overdue, app.home)}
          </Stat>
          <Stat icon={CalendarClock} label="Due within a week" onClick={() => setState('open')} active={state === 'open'}>
            {money(sum.due_7, app.home)}
          </Stat>
          <Stat icon={FilePen} label="Drafts" onClick={() => setState('draft')} active={state === 'draft'}>
            {sum.draft_count}
          </Stat>
          <Stat icon={side === 'sales' ? ArrowDownLeft : ArrowUpRight} label={side === 'sales' ? 'Received, 30 days' : 'Paid, 30 days'} tone="pos">
            {money(sum.paid_30, app.home)}
          </Stat>
        </div>
      )}
      {aged.data !== null && ageTotal > 0 && (
        <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--lf-line)] px-3 py-1.5">
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-[var(--lf-muted)]">
            <Clock size={12} strokeWidth={2.2} />
            By days past due
          </span>
          <Meter keepZero wrap width={180} currency={app.home} items={AGE_BUCKETS.map((b) => ({ label: b.label, value: aged.data!.totals[b.key] ?? 0, color: b.color }))} />
        </div>
      )}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--lf-line)] px-3">
        <Tabs
          value={state}
          onChange={setState}
          className="h-full"
          tabs={[
            { value: '', label: 'All' },
            { value: 'draft', label: 'Drafts' },
            { value: 'unpaid', label: 'Unpaid' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'paid', label: 'Paid' },
            { value: 'void', label: 'Void' },
          ]}
        />
        <span className="flex-1" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find" className={cn(input, 'hidden h-7 w-40 sm:block')} />
        <Menu
          align="right"
          trigger={(_, t) => (
            <Btn size="sm" variant="ghost" onClick={t}>
              More
            </Btn>
          )}
          items={side === 'sales' ? [{ label: 'New credit note', onClick: () => go('sales', { doc: 'new', kind: 'credit_note' }) }] : [{ label: 'New vendor credit', onClick: () => go('purchases', { doc: 'new', kind: 'vendor_credit' }) }]}
        />
        <Btn size="sm" variant="primary" icon={Plus} onClick={() => go(side, { doc: 'new', kind: newKind })}>
          {side === 'sales' ? 'Invoice' : 'Bill'}
        </Btn>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {docs.length === 0 && !live.loading ? (
          <Empty
            icon={side === 'sales' ? FileOutput : FileInput}
            title={state === '' ? (side === 'sales' ? 'No invoices yet' : 'No bills yet') : 'Nothing here'}
            action={
              state === '' ? (
                <Btn variant="primary" icon={Plus} onClick={() => go(side, { doc: 'new', kind: newKind })}>
                  {side === 'sales' ? 'New invoice' : 'New bill'}
                </Btn>
              ) : undefined
            }
          >
            {state === '' ? (side === 'sales' ? 'Invoice customers and follow what they owe. Payments matched from the bank close them.' : 'Record supplier bills to know what you owe and when. Drop a supplier invoice in the Inbox and your AI agent drafts the bill.') : undefined}
          </Empty>
        ) : (
          <table className="lf-table">
            <thead>
              <tr>
                <th className="w-[110px]">Number</th>
                <th>{side === 'sales' ? 'Customer' : 'Supplier'}</th>
                <th className="w-[96px]">Issued</th>
                <th className="hidden w-[96px] md:table-cell">Due</th>
                <th className="r w-[120px]">Total</th>
                <th className="r hidden w-[120px] sm:table-cell">Open</th>
                <th className="w-[110px]">State</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} data-click="true" onClick={() => setQuery({ doc: d.id })} className={d.state === 'void' ? 'opacity-50' : ''}>
                  <td className="num font-semibold">
                    {d.number || <span className="font-normal text-[var(--lf-muted)]">Draft</span>}
                    {d.kind !== 'invoice' && d.kind !== 'bill' && <span className="ml-1.5 text-[11px] font-normal text-[var(--lf-muted)]">{d.kind === 'credit_note' ? 'CN' : 'VC'}</span>}
                  </td>
                  <td className="max-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{d.contact_name}</span>
                      {d.added_by === 'agent' && <AiChip />}
                    </div>
                  </td>
                  <td className="num text-[var(--lf-ink-2)]">{day(d.issue_date, true)}</td>
                  <td className={cn('num hidden md:table-cell', d.state === 'overdue' ? 'text-[var(--lf-neg-text)]' : 'text-[var(--lf-ink-2)]')}>{day(d.due_date, true)}</td>
                  <td className="r num">{money(d.total, d.currency)}</td>
                  <td className="r num hidden sm:table-cell">{d.status === 'approved' && d.open > 0 ? money(d.open, d.currency) : ''}</td>
                  <td>
                    <StateChip d={d} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- editor */

interface EditLine {
  key: number;
  description: string;
  quantity: string;
  unit_price: string;
  account: string;
  tax_code: string;
}

let k = 1;
const blank = (account = '', tax = ''): EditLine => ({ key: k++, description: '', quantity: '1', unit_price: '', account, tax_code: tax });

function PayDialog({ doc, onClose }: { doc: Doc; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const banks = app.accounts.filter(isCash);
  const [account, setAccount] = useState(banks[0]?.id ?? '');
  const [date, setDate] = useState(today());
  const acc = app.account(account);
  const bankCcy = acc?.currency || app.home;
  const cross = bankCcy !== doc.currency;
  const [amount, setAmount] = useState(cross ? '' : toDecimal(doc.open, doc.currency));
  const [docAmount, setDocAmount] = useState(toDecimal(doc.open, doc.currency));
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const pay = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.pay({ doc: doc.id, account, amount: amount || undefined, doc_amount: cross ? docAmount : undefined, date, memo: memo || undefined });
      toast.success('Payment recorded' + (r.fx_diff !== 0 ? ' (exchange difference ' + money(r.fx_diff, app.home) + ')' : ''));
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={doc.kind === 'invoice' || doc.kind === 'vendor_credit' ? 'Record money received' : 'Record a payment'}
      description={DOC_LABEL[doc.kind] + ' ' + doc.number + ' · ' + money(doc.open, doc.currency) + ' open. Paid from a bank line? Book that line in the Inbox instead: it matches this document.'}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={busy} onClick={() => void pay()}>
            Record
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={doc.kind === 'invoice' ? 'Paid into' : 'Paid from'}>
          <AccountPicker label="Bank account" value={account} onChange={setAccount} filter={isCash} order={['asset', 'liability']} />
        </Field>
        <Field label="Date">
          <DateInput value={date} onChange={setDate} />
        </Field>
        <Field label={'Amount (' + bankCcy + ')'}>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        {cross && (
          <Field label={'Settles (' + doc.currency + ')'}>
            <MoneyInput value={docAmount} onChange={setDocAmount} />
          </Field>
        )}
        <Field label="Memo" className="col-span-2">
          <input value={memo} onChange={(e) => setMemo(e.target.value)} className={input} />
        </Field>
      </div>
    </Modal>
  );
}

function CreditDialog({ doc, onClose }: { doc: Doc; onClose: () => void }): React.JSX.Element {
  const creditKind = doc.kind === 'invoice' ? 'credit_note' : 'vendor_credit';
  const live = useLive(() => api.docs({ kind: creditKind, contact: doc.contact, state: 'unpaid' }), ['documents'], [doc.id]);
  const credits = (live.data?.docs ?? []).filter((c) => c.currency === doc.currency && c.open > 0);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title="Apply a credit"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            loading={busy}
            disabled={pick === ''}
            onClick={() => {
              setBusy(true);
              api
                .applyCredit(pick, doc.id)
                .then(() => {
                  toast.success('Credit applied');
                  onClose();
                })
                .catch((err: unknown) => toast.error(errMessage(err)))
                .finally(() => setBusy(false));
            }}
          >
            Apply
          </Btn>
        </>
      }
    >
      {credits.length === 0 ? (
        <p className="text-[12.5px] text-[var(--lf-muted)]">No open {creditKind === 'credit_note' ? 'credit notes' : 'vendor credits'} for {doc.contact_name} in {doc.currency}.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {credits.map((c) => (
            <button key={c.id} type="button" onClick={() => setPick(c.id)} className={cn('flex items-center gap-2 rounded-[5px] border px-2.5 py-2 text-left text-[12.5px]', pick === c.id ? 'border-[var(--lf-ink)] bg-[var(--lf-row)]' : 'border-[var(--lf-line)] hover:bg-[var(--lf-row)]')}>
              <span className="flex-1 font-semibold">{c.number}</span>
              <span className="num">{money(c.open, c.currency)} available</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** The document as printed. */
function Paper({ doc }: { doc: Doc }): React.JSX.Element {
  const app = useApp();
  const s = app.settings;
  const sales = doc.kind === 'invoice' || doc.kind === 'credit_note';
  return (
    <div className="lf-print lf-print-only p-2 text-[12px] leading-[17px] text-[#111]">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-[18px] font-bold">{sales ? s?.business_name : doc.contact_name}</p>
          <p className="whitespace-pre-line">{sales ? s?.business_address : doc.contact_info?.address}</p>
          {sales && s?.business_tax_id ? <p>Tax ID {s.business_tax_id}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-[20px] font-bold uppercase tracking-[0.04em]">{DOC_LABEL[doc.kind]}</p>
          <p>No. {doc.number || 'Draft'}</p>
          <p>Date {day(doc.issue_date)}</p>
          {doc.due_date && <p>Due {day(doc.due_date)}</p>}
          {doc.reference && <p>Ref {doc.reference}</p>}
        </div>
      </div>
      <div className="mt-6">
        <p className="font-bold">{sales ? 'Bill to' : 'From'}</p>
        <p>{sales ? doc.contact_name : s?.business_name}</p>
        <p className="whitespace-pre-line">{sales ? doc.contact_info?.address : ''}</p>
      </div>
      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b border-[#999] text-left">
            <th className="py-1">Description</th>
            <th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Price</th>
            <th className="py-1 text-right">Tax</th>
            <th className="py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {(doc.lines ?? []).map((l) => (
            <tr key={l.id} className="border-b border-[#ddd]">
              <td className="py-1">{l.description}</td>
              <td className="py-1 text-right">{l.quantity}</td>
              <td className="py-1 text-right">{money(l.unit_price, doc.currency, { symbol: false })}</td>
              <td className="py-1 text-right">{app.taxName(l.tax_code)}</td>
              <td className="py-1 text-right">{money(doc.inclusive ? l.total : l.subtotal, doc.currency, { symbol: false })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto mt-3 w-64">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{money(doc.subtotal, doc.currency)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax</span>
          <span>{money(doc.tax_total, doc.currency)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-[#111] pt-1 text-[14px] font-bold">
          <span>Total {doc.currency}</span>
          <span>{money(doc.total, doc.currency)}</span>
        </div>
        {doc.allocated > 0 && (
          <div className="flex justify-between">
            <span>Paid</span>
            <span>{money(doc.allocated, doc.currency)}</span>
          </div>
        )}
        {doc.allocated > 0 && (
          <div className="flex justify-between font-bold">
            <span>Balance due</span>
            <span>{money(doc.open, doc.currency)}</span>
          </div>
        )}
      </div>
      {doc.notes && <p className="mt-6 whitespace-pre-line">{doc.notes}</p>}
      {doc.terms && <p className="mt-3 whitespace-pre-line text-[11px]">{doc.terms}</p>}
      {sales && s?.invoice_footer ? <p className="mt-6 whitespace-pre-line border-t border-[#ccc] pt-2 text-[11px]">{s.invoice_footer}</p> : null}
    </div>
  );
}

function DocEditor({ side, id, kind: newKind }: { side: Side; id: string; kind: DocKind }): React.JSX.Element {
  const app = useApp();
  const isNew = id === 'new';
  const live = useLive(() => (isNew ? Promise.resolve(null) : api.doc(id)), isNew ? [] : ['documents', 'allocations', 'files', 'activity'], [id]);
  const doc = live.data?.document ?? null;
  const kind: DocKind = doc?.kind ?? newKind;
  const sales = kind === 'invoice' || kind === 'credit_note';
  const defaultAccount = useMemo(() => (sales ? (app.accounts.find((a) => a.type === 'income' && a.system !== 'uncat_income')?.id ?? '') : (app.accounts.find((a) => a.system === 'uncat_expense')?.id ?? '')), [app.accounts, sales]);

  const [contact, setContact] = useState('');
  const [issue, setIssue] = useState(today());
  const [due, setDue] = useState('');
  const [number, setNumber] = useState('');
  const [reference, setReference] = useState('');
  const [currency, setCurrency] = useState(app.home);
  const [inclusive, setInclusive] = useState(false);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [lines, setLines] = useState<EditLine[]>([blank()]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState(false);
  const [credit, setCredit] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [writeOff, setWriteOff] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmEl, confirm] = useConfirm();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const seeded = useRef('');

  useEffect(() => {
    if (isNew) {
      if (seeded.current === 'new') return;
      seeded.current = 'new';
      setDue(addDays(today(), app.settings?.payment_terms ?? 14));
      setLines([blank(defaultAccount)]);
      return;
    }
    if (doc === null || (dirty && seeded.current === doc.id)) return;
    seeded.current = doc.id;
    setContact(doc.contact);
    setIssue(doc.issue_date);
    setDue(doc.due_date);
    setNumber(doc.number);
    setReference(doc.reference);
    setCurrency(doc.currency);
    setInclusive(doc.inclusive);
    setNotes(doc.notes);
    setTerms(doc.terms);
    setLines((doc.lines ?? []).map((l) => ({ key: k++, description: l.description, quantity: l.quantity, unit_price: toDecimal(l.unit_price, doc.currency), account: l.account, tax_code: l.tax_code })));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, isNew]);

  useEffect(() => {
    if (isNew && defaultAccount !== '') setLines((ls) => ls.map((l) => (l.account === '' ? { ...l, account: defaultAccount } : l)));
  }, [defaultAccount, isNew]);

  useReportScreen(side, isNew ? null : { type: 'document', id });

  const editable = isNew || (doc !== null && doc.status !== 'void' && doc.allocated === 0);
  const touch = (): void => setDirty(true);
  const setLine = (key: number, patch: Partial<EditLine>): void => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch();
  };

  // A live estimate of the totals (the server's figures are authoritative).
  const est = useMemo(() => {
    let sub = 0;
    let tax = 0;
    for (const l of lines) {
      const amt = Math.round((parseMoney(l.unit_price, currency) ?? 0) * Number(l.quantity || '0'));
      const tc = app.taxCodes.find((t) => t.id === l.tax_code);
      const r = tc && tc.group !== 'reverse' ? Number(tc.rate) : 0;
      const t = r === 0 ? 0 : inclusive ? Math.round((amt * r) / (100 + r)) : Math.round((amt * r) / 100);
      sub += inclusive ? amt - t : amt;
      tax += t;
    }
    return { sub, tax, total: sub + tax };
  }, [lines, currency, inclusive, app.taxCodes]);

  const payload = (): DocInput => ({
    contact,
    issue_date: issue,
    due_date: due || undefined,
    number: !sales || number !== '' ? number : undefined,
    reference,
    currency,
    inclusive,
    notes,
    terms,
    lines: lines.filter((l) => l.description !== '' || l.unit_price !== '').map((l) => ({ description: l.description, quantity: l.quantity || '1', unit_price: l.unit_price || '0', account: l.account || undefined, tax_code: l.tax_code || '' })),
  });

  const save = async (approve: boolean): Promise<void> => {
    if (contact === '') return void toast.error(sales ? 'Choose the customer' : 'Choose the supplier');
    setBusy(true);
    try {
      if (isNew) {
        const r = await api.createDoc({ ...payload(), kind, approve });
        toast.success(approve ? DOC_LABEL[kind] + ' ' + r.document.number + ' approved' : 'Draft saved');
        if (r.warnings && r.warnings.length > 0) toast.error('Possible duplicate: ' + r.warnings[0]!.reason + ' (' + (r.warnings[0]!.number || 'draft') + ')');
        setDirty(false);
        setQuery({ doc: r.document.id, kind: undefined });
      } else {
        if (dirty) await api.updateDoc(id, payload());
        if (approve) {
          const r = await api.approveDoc(id);
          toast.success(DOC_LABEL[kind] + ' ' + (r.documents[0]?.number ?? '') + ' approved');
        } else toast.success('Saved');
        setDirty(false);
      }
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const print = (): void => {
    if (doc === null) return;
    window.print();
  };

  if (!isNew && doc === null)
    return live.error !== null ? (
      <Empty icon={FileText} title="Document not found">
        {live.error}
      </Empty>
    ) : (
      <div className="flex h-24 items-center justify-center">
        <Spinner />
      </div>
    );

  const title = isNew ? 'New ' + (DOC_LABEL[kind] ?? kind).toLowerCase() : DOC_LABEL[kind] + ' ' + (doc?.number || '(draft)');
  return (
    <div className="flex h-full min-h-0 flex-col">
      {confirmEl}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--lf-line)] px-3 lf-no-print">
        <IconBtn icon={ArrowLeft} label="Back to the list" onClick={() => setQuery({ doc: undefined, kind: undefined })} />
        <p className="truncate text-[14px] font-bold">{title}</p>
        {doc !== null && <StateChip d={doc} />}
        {doc?.added_by === 'agent' && <AiChip>Drafted by AI</AiChip>}
        {dirty && <span className="text-[12px] text-[var(--lf-muted)]">Unsaved</span>}
        <span className="flex-1" />
        {doc !== null && (
          <IconBtn icon={Printer} label="Print or save as PDF" onClick={print} />
        )}
        {(isNew || doc?.status === 'draft') && (
          <>
            <Btn loading={busy} onClick={() => void save(false)} disabled={!dirty && !isNew}>
              Save draft
            </Btn>
            <Btn variant="primary" icon={CheckIcon} loading={busy} onClick={() => void save(true)}>
              Approve
            </Btn>
          </>
        )}
        {doc?.status === 'approved' && dirty && (
          <Btn variant="primary" loading={busy} onClick={() => void save(false)}>
            Save changes
          </Btn>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="min-w-0 flex-1 px-4 py-4 lg:overflow-y-auto">
          {doc?.warnings && doc.warnings.length > 0 && (
            <p className="mb-3 flex items-start gap-2 rounded-[5px] bg-[var(--lf-warn-soft)] px-2.5 py-2 text-[12.5px] text-[var(--lf-warn-text)]">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              Possible duplicate of {doc.warnings.map((w) => (w.number || 'a draft') + ' (' + w.reason.toLowerCase() + ')').join(', ')}.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label={sales ? 'Customer' : 'Supplier'} className="col-span-2">
              <ContactPicker
                label={sales ? 'Customer' : 'Supplier'}
                placeholder={sales ? 'Customer' : 'Supplier'}
                value={contact}
                onChange={(v) => {
                  setContact(v);
                  touch();
                }}
                kind={sales ? 'customer' : 'vendor'}
              />
            </Field>
            <Field label="Issue date">
              <DateInput
                value={issue}
                onChange={(v) => {
                  setIssue(v);
                  touch();
                }}
              />
            </Field>
            {kind === 'invoice' || kind === 'bill' ? (
              <Field label="Due date">
                <DateInput
                  value={due}
                  onChange={(v) => {
                    setDue(v);
                    touch();
                  }}
                />
              </Field>
            ) : (
              <span />
            )}
            <Field label={sales ? 'Number' : 'Supplier number'}>
              <input
                value={number}
                disabled={sales && doc?.status === 'approved'}
                placeholder={sales ? 'Given on approval' : 'Their invoice no.'}
                onChange={(e) => {
                  setNumber(e.target.value);
                  touch();
                }}
                className={input}
              />
            </Field>
            <Field label="Reference">
              <input
                value={reference}
                placeholder="PO or project"
                onChange={(e) => {
                  setReference(e.target.value);
                  touch();
                }}
                className={input}
              />
            </Field>
            <Field label="Currency">
              <Select
                label="Currency"
                value={currency}
                onChange={(v) => {
                  setCurrency(v);
                  touch();
                }}
                options={app.currencies.map((c) => ({ value: c.code, label: c.code }))}
              />
            </Field>
            <Field label="Prices include tax">
              <div className="flex h-7 items-center">
                <Toggle
                  checked={inclusive}
                  onChange={(v) => {
                    setInclusive(v);
                    touch();
                  }}
                  label="Prices include tax"
                />
              </div>
            </Field>
          </div>

          <div className="mt-4 overflow-x-auto rounded-[6px] border border-[var(--lf-line)]">
            <table className="lf-table min-w-[720px]">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="r w-[70px]">Qty</th>
                  <th className="r w-[110px]">Price</th>
                  <th className="w-[180px]">Account</th>
                  {app.taxCodes.length > 0 && <th className="w-[100px]">Tax</th>}
                  <th className="r w-[110px]">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const amt = Math.round((parseMoney(l.unit_price, currency) ?? 0) * Number(l.quantity || '0'));
                  return (
                    <tr key={l.key}>
                      <td className="py-1">
                        <input value={l.description} disabled={!editable} onChange={(e) => setLine(l.key, { description: e.target.value })} className={cn(input, 'h-6')} placeholder="What it is" aria-label="Description" />
                      </td>
                      <td className="py-1">
                        <input value={l.quantity} disabled={!editable} inputMode="decimal" onChange={(e) => setLine(l.key, { quantity: e.target.value.replace(/[^\d.]/g, '') })} className={cn(input, 'num h-6 text-right')} aria-label="Quantity" />
                      </td>
                      <td className="py-1">
                        <MoneyInput value={l.unit_price} onChange={(v) => setLine(l.key, { unit_price: v })} className="h-6" label="Price" />
                      </td>
                      <td className="py-1">
                        <AccountPicker label="Line account" value={l.account} onChange={(v) => setLine(l.key, { account: v })} filter={(a) => (sales ? a.type === 'income' || a.type === 'liability' : a.type === 'expense' || a.type === 'asset') && a.system !== 'ar' && a.system !== 'ap'} small />
                      </td>
                      {app.taxCodes.length > 0 && (
                        <td className="py-1">
                          <TaxPicker value={l.tax_code} onChange={(v) => setLine(l.key, { tax_code: v })} scope={sales ? 'sales' : 'purchases'} small />
                        </td>
                      )}
                      <td className="r num py-1">{money(amt, currency, { symbol: false })}</td>
                      <td className="py-1">{editable && <IconBtn icon={Trash2} label="Remove line" size={22} onClick={() => (setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls)), touch())} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-start gap-4">
            {editable && (
              <Btn size="xs" variant="ghost" icon={Plus} onClick={() => (setLines((ls) => [...ls, blank(ls[ls.length - 1]?.account ?? defaultAccount, ls[ls.length - 1]?.tax_code ?? '')]), touch())}>
                Line
              </Btn>
            )}
            <span className="flex-1" />
            <div className="w-64 text-[12.5px]">
              <div className="flex h-6 items-center justify-between">
                <span className="text-[var(--lf-muted)]">Subtotal</span>
                <span className="num">{money(doc !== null && !dirty ? doc.subtotal : est.sub, currency)}</span>
              </div>
              <div className="flex h-6 items-center justify-between">
                <span className="text-[var(--lf-muted)]">Tax</span>
                <span className="num">{money(doc !== null && !dirty ? doc.tax_total : est.tax, currency)}</span>
              </div>
              <div className="flex h-8 items-center justify-between border-t border-[var(--lf-line)] text-[14px] font-bold">
                <span>Total</span>
                <span className="num">{money(doc !== null && !dirty ? doc.total : est.total, currency)}</span>
              </div>
              {doc !== null && doc.allocated > 0 && (
                <div className="flex h-6 items-center justify-between font-semibold">
                  <span>Open</span>
                  <span className="num">{money(doc.open, currency)}</span>
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Notes on the document">
              <textarea
                value={notes}
                rows={3}
                onChange={(e) => {
                  setNotes(e.target.value);
                  touch();
                }}
                className={area}
              />
            </Field>
            <Field label="Terms">
              <textarea
                value={terms}
                rows={3}
                onChange={(e) => {
                  setTerms(e.target.value);
                  touch();
                }}
                className={area}
              />
            </Field>
          </div>
        </div>

        {doc !== null && (
          <aside className="flex w-full shrink-0 flex-col border-t border-[var(--lf-line)] lg:w-[320px] lg:overflow-y-auto lg:border-l lg:border-t-0">
            <div className="flex flex-col gap-2 border-b border-[var(--lf-line)] px-4 py-3">
              {doc.status === 'approved' && doc.open > 0 && (
                <>
                  <Btn variant="primary" icon={Banknote} onClick={() => setPay(true)}>
                    {doc.kind === 'invoice' || doc.kind === 'vendor_credit' ? 'Record money received' : 'Record payment'}
                  </Btn>
                  {(doc.kind === 'invoice' || doc.kind === 'bill') && <Btn onClick={() => setCredit(true)}>Apply a credit</Btn>}
                </>
              )}
              {doc.kind === 'invoice' && doc.status === 'approved' && doc.open > 0 && (
                <Btn
                  icon={Sparkles}
                  onClick={() =>
                    void api
                      .remind(doc.id)
                      .then((r) => toast.success(r.asked ? 'Your AI agent is drafting a reminder' : 'Queued for your AI agent'))
                      .catch((err: unknown) => toast.error(errMessage(err)))
                  }
                >
                  Draft a reminder
                </Btn>
              )}
              <div className="flex flex-wrap gap-2">
                {doc.status === 'approved' && (
                  <Btn size="sm" icon={Mail} onClick={() => void api.markSent(doc.id, doc.sent_at === '').catch((err: unknown) => toast.error(errMessage(err)))}>
                    {doc.sent_at !== '' ? 'Sent ' + day(doc.sent_at, true) : 'Mark sent'}
                  </Btn>
                )}
                <Menu
                  align="right"
                  trigger={(_, t) => (
                    <Btn size="sm" onClick={t}>
                      More
                    </Btn>
                  )}
                  items={[
                    { label: 'Duplicate', icon: Copy, onClick: () => void api.duplicateDoc(doc.id).then((r) => setQuery({ doc: r.document.id })).catch((err: unknown) => toast.error(errMessage(err))) },
                    ...(doc.kind === 'invoice' ? [{ label: 'Credit note for this', onClick: () => void api.duplicateDoc(doc.id, 'credit_note').then((r) => setQuery({ doc: r.document.id })).catch((err: unknown) => toast.error(errMessage(err))) }] : []),
                    { label: 'Repeat on a schedule', onClick: () => go('setup', { tab: 'recurring', from: 'document', id: doc.id }) },
                    ...(doc.txn !== '' ? [{ label: 'Open the entry', onClick: () => go('ledger', { txn: doc.txn }) }] : []),
                    'divider' as const,
                    ...(doc.kind === 'invoice' && doc.status === 'approved' && doc.open > 0 ? [{ label: 'Write off as bad debt', danger: true, onClick: () => setWriteOff(true) }] : []),
                    ...(doc.status !== 'void' ? [{ label: doc.status === 'draft' ? 'Discard draft' : 'Void', danger: true, onClick: () => setVoiding(true) }] : []),
                  ]}
                />
              </div>
            </div>
            {doc.reminder !== '' && (
              <div className="border-b border-[var(--lf-line)] px-4 py-3">
                <Heading
                  action={
                    <Btn size="xs" variant="ghost" onClick={() => void navigator.clipboard.writeText(doc.reminder).then(() => toast.success('Copied'))}>
                      Copy
                    </Btn>
                  }
                >
                  Reminder from your AI agent
                </Heading>
                <p className="lf-prose text-[12.5px] leading-[18px] text-[var(--lf-ink-2)]">{doc.reminder}</p>
              </div>
            )}
            <div className="border-b border-[var(--lf-line)] px-4 py-3">
              <Heading>Payments and credits</Heading>
              {(doc.allocations ?? []).length === 0 && <p className="text-[12px] text-[var(--lf-muted)]">{doc.status === 'draft' ? 'Approve it to record payments.' : 'Nothing paid yet.'}</p>}
              {(doc.allocations ?? []).map((a) => (
                <div key={a.id} className="group flex h-8 items-center gap-2 border-b border-[var(--lf-hair)] text-[12.5px]">
                  <span className="num w-[60px] shrink-0 text-[var(--lf-muted)]">{day(a.date, true)}</span>
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => (a.payment ? go('ledger', { txn: a.payment }) : setQuery({ doc: a.credit_doc === doc.id ? a.document : a.credit_doc }))}>
                    {a.kind === 'credit' ? 'Credit' : a.kind === 'writeoff' ? 'Written off' : 'Payment'}
                  </button>
                  <Money value={a.amount} currency={doc.currency} />
                  <IconBtn
                    icon={X}
                    label="Remove"
                    size={20}
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() =>
                      void confirm(a.kind === 'credit' ? 'The credit becomes available again.' : 'Its entry is voided and the document opens again.', 'Remove this ' + (a.kind === 'credit' ? 'credit' : a.kind === 'writeoff' ? 'write-off' : 'payment') + '?', 'Remove').then((ok) => {
                        if (ok) api.removeAllocation(a.id).catch((err: unknown) => toast.error(errMessage(err)));
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <div className="border-b border-[var(--lf-line)] px-4 py-3">
              <Heading
                action={
                  <Btn size="xs" variant="ghost" icon={Upload} onClick={() => fileRef.current?.click()}>
                    Attach
                  </Btn>
                }
              >
                Files
              </Heading>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const fs = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (fs.length > 0)
                    api
                      .upload(fs, { link_type: 'document', link_id: doc.id })
                      .then(() => toast.success('Attached'))
                      .catch((err: unknown) => toast.error(errMessage(err)));
                }}
              />
              {(doc.files ?? []).length === 0 && <p className="text-[12px] text-[var(--lf-muted)]">No file attached.</p>}
              {(doc.files ?? []).map((f) => (
                <a key={f.id} href={api.fileUrl(f.id)} target="_blank" rel="noreferrer" className="flex h-7 items-center gap-2 text-[12.5px] hover:underline">
                  <FileText size={13} className="shrink-0 text-[var(--lf-ink-2)]" />
                  <span className="truncate">{f.name}</span>
                </a>
              ))}
            </div>
            <div className="px-4 py-3">
              <Heading>Details</Heading>
              <KV k="Home value">{money(doc.home_total, app.home)}</KV>
              {doc.rate !== '' && <KV k="Rate">{doc.rate}</KV>}
              {doc.contact_info?.email && <KV k="Email">{doc.contact_info.email}</KV>}
              <KV k="Created">{ago(doc.created)}</KV>
              {(doc.history ?? []).slice(0, 8).map((h) => (
                <div key={h.id} className="flex items-start gap-2 border-b border-[var(--lf-hair)] py-1.5 text-[12px]">
                  {h.actor === 'agent' ? <Sparkles size={12} className="mt-0.5 shrink-0 text-[var(--lf-accent-text)]" /> : <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--lf-muted)]" />}
                  <span className="min-w-0 flex-1">{h.summary}</span>
                  <span className="shrink-0 text-[11px] text-[var(--lf-muted)]">{ago(h.created)}</span>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
      {doc !== null && <Paper doc={doc} />}
      {pay && doc !== null && <PayDialog doc={doc} onClose={() => setPay(false)} />}
      {credit && doc !== null && <CreditDialog doc={doc} onClose={() => setCredit(false)} />}
      {voiding && doc !== null && (
        <Modal
          open
          width="sm"
          title={doc.status === 'draft' ? 'Discard this draft?' : 'Void ' + doc.number + '?'}
          description={doc.status === 'draft' ? undefined : 'Its entry is voided; the number stays used. Remove payments first.'}
          onClose={() => setVoiding(false)}
          footer={
            <>
              <Btn onClick={() => setVoiding(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  setVoiding(false);
                  api
                    .voidDoc(doc.id, reason)
                    .then(() => toast.success(doc.status === 'draft' ? 'Draft discarded' : 'Voided'))
                    .catch((err: unknown) => toast.error(errMessage(err)));
                }}
              >
                {doc.status === 'draft' ? 'Discard' : 'Void'}
              </Btn>
            </>
          }
        >
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={input} placeholder="Why (optional)" />
        </Modal>
      )}
      {writeOff && doc !== null && (
        <Modal
          open
          width="sm"
          title={'Write off ' + money(doc.open, doc.currency) + '?'}
          description="The rest of this invoice is booked as a bad debt expense."
          onClose={() => setWriteOff(false)}
          footer={
            <>
              <Btn onClick={() => setWriteOff(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  setWriteOff(false);
                  api
                    .writeOff(doc.id, reason)
                    .then(() => toast.success('Written off'))
                    .catch((err: unknown) => toast.error(errMessage(err)));
                }}
              >
                Write off
              </Btn>
            </>
          }
        >
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={input} placeholder="Why (optional)" />
        </Modal>
      )}
    </div>
  );
}

export function DocsView({ side, q }: { side: Side; q: Record<string, string> }): React.JSX.Element {
  useReportScreen(side, null, { state: q['state'] ?? '' });
  const id = q['doc'];
  if (id !== undefined && id !== '') {
    const kind = (q['kind'] as DocKind | undefined) ?? (side === 'sales' ? 'invoice' : 'bill');
    return <DocEditor key={id} side={side} id={id} kind={kind} />;
  }
  return <DocList side={side} q={q} />;
}
