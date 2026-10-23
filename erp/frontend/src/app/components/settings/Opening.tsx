/**
 * Opening balances at the cut-over date, in three parts: account balances
 * (the difference goes to opening balance equity), open invoices and bills
 * (each becomes a posted document that can be paid), and opening stock.
 * Each part shows exactly what it posts before it posts. What was already
 * entered is listed with links.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BookOpen, Boxes, Check, FileText, Landmark, Plus, Trash2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { dayLabel, today } from '../../lib/dates.ts';
import { decimalsOf, money, normalizeNumber, plural } from '../../lib/format.ts';
import { changed, READS, useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { navigate } from '../../lib/router.ts';
import type { CompanySettings, OpeningJournal } from '../../lib/types/settings.ts';
import type { JournalPreviewLine } from '../../lib/types.ts';
import { JournalLines } from '../Books.tsx';
import { Segmented } from '../controls.tsx';
import type { Option } from '../pickers.tsx';
import { AccountPicker, DateField, ItemPicker, MoneyInput, NumberInput, PartyPicker, WarehousePicker } from '../pickers.tsx';
import { Card, CardHeader, CircleButton, Field, Modal, Notice, PillButton, Skeleton, cellInput } from '../ui.tsx';
import { textToMinor } from './shared.tsx';

type Part = 'accounts' | 'documents' | 'stock';

let seq = 0;
const key = (): string => `r${++seq}`;

interface AccRow {
  key: string;
  account: Option | null;
  debit: string;
  credit: string;
  memo: string;
}
interface DocRow {
  key: string;
  party: Option | null;
  number: string;
  date: string;
  due: string;
  amount: string;
}
interface StockRow {
  key: string;
  item: Option | null;
  qty: string;
  cost: string;
}

interface StockChangeRow {
  id: string;
  number: string;
  date: string;
  reason: string;
  value: number;
  warehouse: { name: string } | null;
}

function fiscalStart(month: number): string {
  const t = today();
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  const year = m >= month ? y : y - 1;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function codeOf(o: Option | null): string {
  if (o === null) return '';
  return (o.data as { code?: string } | undefined)?.code ?? o.id;
}

export function OpeningSection({ s }: { s: CompanySettings }): React.JSX.Element {
  const me = useMe();
  const cur = s.base_currency;
  const stockOk = can(me, 'inventory', 'edit');
  const done = useLive(
    () =>
      Promise.all([
        op<{ journals: OpeningJournal[] }>('journals.list', { kind: 'opening', limit: 200 }, { quiet: true }),
        stockOk ? op<{ changes: StockChangeRow[] }>('stock.changes', { kind: 'adjust', limit: 200 }, { quiet: true }).catch(() => ({ changes: [] as StockChangeRow[] })) : Promise.resolve({ changes: [] as StockChangeRow[] }),
      ]),
    [...READS.books, 'stock_changes', 'documents'],
    [stockOk],
  );
  const journals = done.data?.[0].journals ?? [];
  const stockChanges = (done.data?.[1].changes ?? []).filter((c) => c.reason === 'opening');
  const [date, setDate] = useState('');
  const [part, setPart] = useState<Part>('accounts');

  // The cut-over: the date already used, else the start of this fiscal year.
  useEffect(() => {
    if (date !== '' || done.data === null) return;
    const used = journals.find((j) => j.source === null || j.source.entity === '')?.date ?? journals[0]?.date;
    setDate(used ?? fiscalStart(s.fiscal_start_month || 1));
  }, [done.data, date, journals, s.fiscal_start_month]);

  const ob = s.default_accounts?.['opening_balance'] ?? null;

  return (
    <div className="flex flex-col gap-5">
      <Card tone="sand" delay={1}>
        <div className="grid grid-cols-1 items-end gap-4 @min-[640px]:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <p className="text-[15px] font-bold">Where the books start</p>
            <p className="mt-1 text-[13px] leading-5 text-[var(--erp-ink-2)]">
              Enter what the company owned and owed on the cut-over day: bank and other balances, what customers and suppliers still owe, and the stock on the shelves. Each part posts against {ob !== null ? `${ob.code} ${ob.name}` : 'opening balance equity'}.
            </p>
          </div>
          <Field label="Cut-over date">
            <DateField value={date} onChange={setDate} ariaLabel="Cut-over date" />
          </Field>
        </div>
      </Card>

      <Card delay={2}>
        <CardHeader icon={BookOpen} title="Already entered" />
        {done.data === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : journals.length === 0 && stockChanges.length === 0 ? (
          <p className="text-[13px] text-[var(--erp-muted)]">No opening balances yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {journals.map((j) => (
              <li key={j.id}>
                <button type="button" onClick={() => (j.source !== null && j.source.entity === 'documents' ? navigate('doc', { id: j.source.id }) : navigate('journal', { id: j.id }))} className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left hover:bg-[var(--erp-row)]">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-row)]">{j.source !== null && j.source.entity === 'documents' ? <FileText size={15} aria-hidden /> : <Landmark size={15} aria-hidden />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{j.source !== null && j.source.label !== '' ? j.source.label : j.memo}</span>
                    <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                      {j.number} · {dayLabel(j.date)}
                    </span>
                  </span>
                  <span className="num shrink-0 text-[14px] font-bold">{money(j.total, cur)}</span>
                  <ArrowUpRight size={15} aria-hidden className="shrink-0 text-[var(--erp-muted)]" />
                </button>
              </li>
            ))}
            {stockChanges.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => navigate('stock-change', { id: c.id })} className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left hover:bg-[var(--erp-row)]">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-row)]">
                    <Boxes size={15} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">Opening stock{c.warehouse !== null ? ` in ${c.warehouse.name}` : ''}</span>
                    <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                      {c.number} · {dayLabel(c.date)}
                    </span>
                  </span>
                  <span className="num shrink-0 text-[14px] font-bold">{money(c.value, cur)}</span>
                  <ArrowUpRight size={15} aria-hidden className="shrink-0 text-[var(--erp-muted)]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="erp-rise erp-d3">
        <Segmented<Part>
          ariaLabel="Part"
          onShell
          value={part}
          onChange={setPart}
          className="w-full @min-[640px]:w-[480px]"
          options={[
            { value: 'accounts', label: 'Balances', icon: Landmark },
            { value: 'documents', label: 'Invoices and bills', icon: FileText },
            { value: 'stock', label: 'Stock', icon: Boxes },
          ]}
        />
      </div>

      {part === 'accounts' && <AccountsPart date={date} cur={cur} ob={ob} />}
      {part === 'documents' && <DocumentsPart date={date} cur={cur} s={s} />}
      {part === 'stock' && (stockOk ? <StockPart date={date} cur={cur} s={s} /> : <Notice>Opening stock also needs Inventory edit rights.</Notice>)}
    </div>
  );
}

/* ----------------------------------------------------- account balances */

function AccountsPart({ date, cur, ob }: { date: string; cur: string; ob: { id: string; code: string; name: string } | null }): React.JSX.Element {
  const blank = (): AccRow => ({ key: key(), account: null, debit: '', credit: '', memo: '' });
  const [rows, setRows] = useState<AccRow[]>(() => [blank(), blank(), blank()]);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const filled = rows.filter((r) => r.account !== null && (r.debit !== '' || r.credit !== ''));
  const dr = filled.reduce((sum, r) => sum + (textToMinor(r.debit, cur) ?? 0), 0);
  const cr = filled.reduce((sum, r) => sum + (textToMinor(r.credit, cur) ?? 0), 0);
  const diff = dr - cr;
  const set = (k: string, patch: Partial<AccRow>): void => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));

  const lines: JournalPreviewLine[] = useMemo(() => {
    const out: JournalPreviewLine[] = filled.map((r) => ({
      account: { id: r.account?.id ?? '', code: codeOf(r.account), name: (r.account?.data as { name?: string } | undefined)?.name ?? r.account?.label ?? '' },
      debit: textToMinor(r.debit, cur) ?? 0,
      credit: textToMinor(r.credit, cur) ?? 0,
      memo: r.memo,
      party: '',
    }));
    if (diff !== 0 && ob !== null) out.push({ account: ob, debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0, memo: 'Opening balance difference', party: '' });
    return out;
  }, [filled, diff, ob, cur]);

  const post = async (): Promise<void> => {
    setBusy(true);
    try {
      const j = await op<{ number: string }>('opening.accounts', { date, lines: filled.map((r) => ({ account: codeOf(r.account), debit: r.debit === '' ? undefined : r.debit, credit: r.credit === '' ? undefined : r.credit, memo: r.memo === '' ? undefined : r.memo })) });
      toast.success(`Opening balances posted as ${j.number}`);
      setPreview(false);
      setRows([blank(), blank(), blank()]);
      changed('journals');
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card delay={3}>
      <CardHeader title="Account balances" subtitle="Bank, cash, loans, equity and other accounts. Customers, suppliers and stock have their own parts." />
      <div className="hidden grid-cols-[minmax(0,2fr)_150px_150px_minmax(0,1fr)_36px] gap-2 px-1 pb-1 text-[12px] font-semibold text-[var(--erp-muted)] @min-[640px]:grid">
        <span>Account</span>
        <span className="text-right">Debit</span>
        <span className="text-right">Credit</span>
        <span>Memo</span>
        <span />
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-2 gap-2 rounded-[16px] border border-[var(--erp-line)] p-2 @min-[640px]:grid-cols-[minmax(0,2fr)_150px_150px_minmax(0,1fr)_36px] @min-[640px]:border-0 @min-[640px]:p-0">
            <AccountPicker value={r.account} onChange={(o) => set(r.key, { account: o })} postable size="cell" className="col-span-2 @min-[640px]:col-span-1" />
            <MoneyInput value={r.debit} onChange={(v) => set(r.key, { debit: v, credit: v !== '' ? '' : r.credit })} currency={cur} ariaLabel="Debit" size="cell" placeholder="Debit" />
            <MoneyInput value={r.credit} onChange={(v) => set(r.key, { credit: v, debit: v !== '' ? '' : r.debit })} currency={cur} ariaLabel="Credit" size="cell" placeholder="Credit" />
            <input value={r.memo} onChange={(e) => set(r.key, { memo: e.target.value })} aria-label="Memo" placeholder="Memo" className={cn(cellInput, 'col-span-2 @min-[640px]:col-span-1')} maxLength={200} />
            <CircleButton icon={Trash2} label="Remove line" variant="ghost" size={36} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))} className="justify-self-end" />
          </div>
        ))}
      </div>
      <PillButton size="sm" variant="soft" icon={Plus} className="mt-3" onClick={() => setRows((rs) => [...rs, blank()])}>
        Add a line
      </PillButton>
      <div className="mt-5 flex flex-col gap-3 rounded-[18px] bg-[var(--erp-row)] p-4 @min-[640px]:flex-row @min-[640px]:items-center">
        <div className="grid flex-1 grid-cols-3 gap-3">
          <Total label="Debits" value={money(dr, cur)} />
          <Total label="Credits" value={money(cr, cur)} />
          <Total label="Difference" value={money(Math.abs(diff), cur)} strong={diff !== 0} />
        </div>
        <PillButton icon={Check} dot disabled={filled.length === 0 || date === ''} onClick={() => setPreview(true)}>
          Review and post
        </PillButton>
      </div>
      {diff !== 0 && <p className="mt-2 px-1 text-[12px] text-[var(--erp-muted)]">The difference goes to {ob !== null ? `${ob.code} ${ob.name}` : 'opening balance equity'}.</p>}
      <PostModal open={preview} onClose={() => setPreview(false)} title="Post opening balances" busy={busy} onPost={() => void post()} summary={`As at ${date !== '' ? dayLabel(date) : ''}: ${plural(filled.length, 'account')}.`}>
        <JournalLines lines={lines} currency={cur} />
      </PostModal>
    </Card>
  );
}

/* ------------------------------------------------------ invoices and bills */

function DocumentsPart({ date, cur, s }: { date: string; cur: string; s: CompanySettings }): React.JSX.Element {
  const [type, setType] = useState<'invoice' | 'bill'>('invoice');
  const blank = (): DocRow => ({ key: key(), party: null, number: '', date: '', due: '', amount: '' });
  const [rows, setRows] = useState<DocRow[]>(() => [blank(), blank()]);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const filled = rows.filter((r) => r.party !== null && r.amount !== '');
  const total = filled.reduce((sum, r) => sum + (textToMinor(r.amount, cur) ?? 0), 0);
  const set = (k: string, patch: Partial<DocRow>): void => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const control = s.default_accounts?.[type === 'invoice' ? 'ar' : 'ap'] ?? null;
  const ob = s.default_accounts?.['opening_balance'] ?? null;

  const lines: JournalPreviewLine[] =
    control !== null && ob !== null && total > 0
      ? type === 'invoice'
        ? [
            { account: control, debit: total, credit: 0, memo: plural(filled.length, 'open invoice'), party: '' },
            { account: ob, debit: 0, credit: total, memo: 'Opening balances', party: '' },
          ]
        : [
            { account: ob, debit: total, credit: 0, memo: 'Opening balances', party: '' },
            { account: control, debit: 0, credit: total, memo: plural(filled.length, 'open bill'), party: '' },
          ]
      : [];

  const post = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ documents: { number: string }[] }>('opening.documents', {
        type,
        date,
        lines: filled.map((x) => ({ party: x.party?.id ?? '', number: x.number.trim(), date: x.date === '' ? undefined : x.date, due_date: x.due === '' ? undefined : x.due, amount: x.amount })),
      });
      toast.success(`${plural(r.documents.length, type === 'invoice' ? 'open invoice' : 'open bill')} entered`);
      setPreview(false);
      setRows([blank(), blank()]);
      changed('documents', 'journals');
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card delay={3}>
      <CardHeader
        title="Open invoices and bills"
        subtitle="Each one becomes a posted document that can be paid as usual."
        action={<Segmented<'invoice' | 'bill'> ariaLabel="Kind" value={type} onChange={(v) => { setType(v); setRows([blank(), blank()]); }} options={[{ value: 'invoice', label: 'Invoices' }, { value: 'bill', label: 'Bills' }]} />}
      />
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_150px_150px_150px_36px] gap-2 px-1 pb-1 text-[12px] font-semibold text-[var(--erp-muted)] @min-[900px]:grid">
        <span>{type === 'invoice' ? 'Customer' : 'Supplier'}</span>
        <span>Their number</span>
        <span>Date</span>
        <span>Due</span>
        <span className="text-right">Still owed</span>
        <span />
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-2 gap-2 rounded-[16px] border border-[var(--erp-line)] p-2 @min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_150px_150px_150px_36px] @min-[900px]:border-0 @min-[900px]:p-0">
            <PartyPicker value={r.party} onChange={(o) => set(r.key, { party: o })} role={type === 'invoice' ? 'customer' : 'supplier'} className="col-span-2 @min-[900px]:col-span-1" />
            <input value={r.number} onChange={(e) => set(r.key, { number: e.target.value })} aria-label="Number" placeholder={type === 'invoice' ? 'INV-0981' : 'Their bill number'} className={cellInput} maxLength={40} />
            <DateField value={r.date} onChange={(v) => set(r.key, { date: v })} ariaLabel="Date" optional placeholder="Cut-over" size="cell" />
            <DateField value={r.due} onChange={(v) => set(r.key, { due: v })} ariaLabel="Due date" optional placeholder="Due" size="cell" align="right" />
            <MoneyInput value={r.amount} onChange={(v) => set(r.key, { amount: v })} currency={cur} ariaLabel="Amount still owed" size="cell" />
            <CircleButton icon={Trash2} label="Remove line" variant="ghost" size={36} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))} className="justify-self-end" />
          </div>
        ))}
      </div>
      <PillButton size="sm" variant="soft" icon={Plus} className="mt-3" onClick={() => setRows((rs) => [...rs, blank()])}>
        Add a line
      </PillButton>
      <div className="mt-5 flex flex-col gap-3 rounded-[18px] bg-[var(--erp-row)] p-4 @min-[640px]:flex-row @min-[640px]:items-center">
        <div className="grid flex-1 grid-cols-2 gap-3">
          <Total label={type === 'invoice' ? 'Invoices' : 'Bills'} value={String(filled.length)} />
          <Total label={type === 'invoice' ? 'Customers owe' : 'You owe'} value={money(total, cur)} strong />
        </div>
        <PillButton icon={Check} dot disabled={filled.length === 0 || date === ''} onClick={() => setPreview(true)}>
          Review and post
        </PillButton>
      </div>
      <PostModal open={preview} onClose={() => setPreview(false)} title={type === 'invoice' ? 'Enter open invoices' : 'Enter open bills'} busy={busy} onPost={() => void post()} summary={`${plural(filled.length, type === 'invoice' ? 'invoice' : 'bill')} as at ${date !== '' ? dayLabel(date) : ''}, posted and open for payment.`}>
        <ul className="mb-4 flex flex-col gap-1">
          {filled.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 rounded-[14px] bg-[var(--erp-row)] px-3 py-2 text-[13px]">
              <span className="min-w-0 truncate">
                <span className="font-semibold">{r.party?.label}</span>
                {r.number !== '' ? ` · ${r.number}` : ''}
                {r.due !== '' ? ` · due ${dayLabel(r.due)}` : ''}
              </span>
              <span className="num shrink-0 font-bold">{money(textToMinor(r.amount, cur) ?? 0, cur)}</span>
            </li>
          ))}
        </ul>
        {lines.length > 0 && <JournalLines lines={lines} currency={cur} />}
      </PostModal>
    </Card>
  );
}

/* --------------------------------------------------------- opening stock */

function StockPart({ date, cur, s }: { date: string; cur: string; s: CompanySettings }): React.JSX.Element {
  const [warehouse, setWarehouse] = useState<Option | null>(null);
  const blank = (): StockRow => ({ key: key(), item: null, qty: '', cost: '' });
  const [rows, setRows] = useState<StockRow[]>(() => [blank(), blank()]);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = decimalsOf(cur);
  const valueOf = (r: StockRow): number => {
    const q = Number(normalizeNumber(r.qty, 3) ?? '0');
    const c = Number(normalizeNumber(r.cost, 4) ?? '0');
    return Math.round(q * c * 10 ** d);
  };
  const filled = rows.filter((r) => r.item !== null && r.qty !== '' && Number(r.qty) > 0);
  const total = filled.reduce((sum, r) => sum + valueOf(r), 0);
  const set = (k: string, patch: Partial<StockRow>): void => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const inv = s.default_accounts?.['inventory'] ?? null;
  const ob = s.default_accounts?.['opening_balance'] ?? null;
  const lines: JournalPreviewLine[] =
    inv !== null && ob !== null && total > 0
      ? [
          { account: inv, debit: total, credit: 0, memo: 'Opening stock', party: '' },
          { account: ob, debit: 0, credit: total, memo: 'Opening stock', party: '' },
        ]
      : [];

  const post = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ number?: string | undefined }>('opening.stock', { date, warehouse: warehouse?.id, lines: filled.map((x) => ({ item: x.item?.id ?? '', qty: normalizeNumber(x.qty, 3) ?? x.qty, unit_cost: x.cost === '' ? undefined : x.cost })) });
      toast.success(`Opening stock entered${r.number !== undefined ? ` as ${r.number}` : ''}`);
      setPreview(false);
      setRows([blank(), blank()]);
      changed('stock_changes', 'journals', 'stock');
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card delay={3}>
      <CardHeader title="Opening stock" subtitle="What is on the shelves at the cut-over, at what it cost." />
      <Field label="Warehouse" className="mb-4 max-w-sm" hint="The main one when empty">
        <WarehousePicker value={warehouse} onChange={setWarehouse} clearable />
      </Field>
      <div className="hidden grid-cols-[minmax(0,2fr)_130px_150px_150px_36px] gap-2 px-1 pb-1 text-[12px] font-semibold text-[var(--erp-muted)] @min-[640px]:grid">
        <span>Item</span>
        <span className="text-right">Quantity</span>
        <span className="text-right">Cost each</span>
        <span className="text-right">Value</span>
        <span />
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-3 items-center gap-2 rounded-[16px] border border-[var(--erp-line)] p-2 @min-[640px]:grid-cols-[minmax(0,2fr)_130px_150px_150px_36px] @min-[640px]:border-0 @min-[640px]:p-0">
            <ItemPicker value={r.item} onChange={(o) => set(r.key, { item: o, cost: r.cost === '' && o !== null ? ((o.data as { purchase_price?: string } | undefined)?.purchase_price ?? '') : r.cost })} kind="stock" size="cell" className="col-span-3 @min-[640px]:col-span-1" />
            <NumberInput value={r.qty} onChange={(v) => set(r.key, { qty: v })} ariaLabel="Quantity" size="cell" />
            <MoneyInput value={r.cost} onChange={(v) => set(r.key, { cost: v })} currency={cur} ariaLabel="Cost each" size="cell" decimals={4} />
            <span className="num pr-1 text-right text-[14px] font-semibold">{money(valueOf(r), cur)}</span>
            <CircleButton icon={Trash2} label="Remove line" variant="ghost" size={36} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))} className="hidden justify-self-end @min-[640px]:inline-flex" />
          </div>
        ))}
      </div>
      <PillButton size="sm" variant="soft" icon={Plus} className="mt-3" onClick={() => setRows((rs) => [...rs, blank()])}>
        Add a line
      </PillButton>
      <div className="mt-5 flex flex-col gap-3 rounded-[18px] bg-[var(--erp-row)] p-4 @min-[640px]:flex-row @min-[640px]:items-center">
        <div className="grid flex-1 grid-cols-2 gap-3">
          <Total label="Items" value={String(filled.length)} />
          <Total label="Stock value" value={money(total, cur)} strong />
        </div>
        <PillButton icon={Check} dot disabled={filled.length === 0 || date === ''} onClick={() => setPreview(true)}>
          Review and post
        </PillButton>
      </div>
      <PostModal open={preview} onClose={() => setPreview(false)} title="Enter opening stock" busy={busy} onPost={() => void post()} summary={`${plural(filled.length, 'item')} into ${warehouse?.label ?? 'the main warehouse'} as at ${date !== '' ? dayLabel(date) : ''}.`}>
        {lines.length > 0 ? <JournalLines lines={lines} currency={cur} /> : <p className="text-[13px] text-[var(--erp-muted)]">The stock comes in at no value.</p>}
      </PostModal>
    </Card>
  );
}

/* ---------------------------------------------------------------- shared */

function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean | undefined }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <span className="block text-[12px] font-semibold text-[var(--erp-muted)]">{label}</span>
      <span className={cn('num block truncate text-[15px]', strong ? 'font-extrabold' : 'font-bold')}>{value}</span>
    </div>
  );
}

function PostModal({ open, onClose, title, summary, busy, onPost, children }: { open: boolean; onClose: () => void; title: string; summary: string; busy: boolean; onPost: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Back to editing
          </PillButton>
          <PillButton icon={Check} dot loading={busy} onClick={onPost}>
            Post
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[14px] leading-6 text-[var(--erp-ink-2)]">{summary}</p>
        {children}
      </div>
    </Modal>
  );
}
