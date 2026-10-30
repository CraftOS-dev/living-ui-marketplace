/**
 * App-wide dialogs, opened from the New menu, the palette and the views:
 * a new or edited entry (expense, income, transfer, journal), importing a
 * bank statement (with CSV column mapping), and adding receipts.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, ArrowDownToLine, FileText, Plus, Trash2, Upload } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import type { EntryInput } from '../lib/api.ts';
import { day, money, parseMoney, toDecimal, today } from '../lib/format.ts';
import { go } from '../lib/router.ts';
import { useApp } from '../lib/store.tsx';
import type { Mapping, Preview, TxnDetail } from '../lib/types.ts';
import { AccountPicker, ContactPicker, DateInput, Money, MoneyInput, Tabs, TaxPicker, isCash, isPostable } from './controls.tsx';
import { Btn, Chip, Field, IconBtn, Modal, Select, Toggle, area, input } from './ui.tsx';

type EntryKind = 'expense' | 'income' | 'transfer' | 'journal';

interface Dialogs {
  openEntry: (kind?: EntryKind, preset?: Partial<EntryInput>) => void;
  editEntry: (txn: TxnDetail) => void;
  openImport: (account?: string) => void;
  openUpload: () => void;
}

const Ctx = createContext<Dialogs | null>(null);

export function useDialogs(): Dialogs {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useDialogs outside DialogsProvider');
  return v;
}

export function DialogsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [entry, setEntry] = useState<{ kind: EntryKind; preset?: Partial<EntryInput> | undefined; edit?: TxnDetail | undefined } | null>(null);
  const [imp, setImp] = useState<{ account?: string | undefined } | null>(null);
  const [upload, setUpload] = useState(false);
  const openEntry = useCallback((kind: EntryKind = 'expense', preset?: Partial<EntryInput>) => setEntry({ kind, preset }), []);
  const editEntry = useCallback((txn: TxnDetail) => setEntry({ kind: 'journal', edit: txn }), []);
  const openImport = useCallback((account?: string) => setImp({ account }), []);
  const openUpload = useCallback(() => setUpload(true), []);
  const value = useMemo(() => ({ openEntry, editEntry, openImport, openUpload }), [openEntry, editEntry, openImport, openUpload]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {entry !== null && <EntryDialog initial={entry.kind} preset={entry.preset} edit={entry.edit} onClose={() => setEntry(null)} />}
      {imp !== null && <ImportDialog account={imp.account} onClose={() => setImp(null)} />}
      {upload && <UploadDialog onClose={() => setUpload(false)} />}
    </Ctx.Provider>
  );
}

/* ------------------------------------------------------------------ entry */

interface JLine {
  key: number;
  account: string;
  debit: string;
  credit: string;
  memo: string;
  tax_code?: string | undefined;
  tax_role?: string | undefined;
}

let lineKey = 1;
const blankLine = (): JLine => ({ key: lineKey++, account: '', debit: '', credit: '', memo: '' });

function EntryDialog({ initial, preset, edit, onClose }: { initial: EntryKind; preset?: Partial<EntryInput> | undefined; edit?: TxnDetail | undefined; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const [kind, setKind] = useState<EntryKind>(initial);
  const [date, setDate] = useState(edit?.date ?? preset?.date ?? today());
  const [amount, setAmount] = useState(preset?.amount ?? '');
  const [from, setFrom] = useState(preset?.from ?? '');
  const [to, setTo] = useState(preset?.to ?? '');
  const [category, setCategory] = useState(preset?.category ?? '');
  const [tax, setTax] = useState(preset?.tax_code ?? '');
  const [inclusive, setInclusive] = useState(true);
  const [amountTo, setAmountTo] = useState('');
  const [contact, setContact] = useState(edit?.contact ?? preset?.contact ?? '');
  const [narration, setNarration] = useState(edit?.narration ?? preset?.narration ?? '');
  const [reference, setReference] = useState(edit?.reference ?? '');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<JLine[]>(() =>
    edit !== undefined
      ? edit.postings.map((p) => ({ key: lineKey++, account: p.account, debit: p.amount > 0 ? toDecimal(p.amount, p.currency) : '', credit: p.amount < 0 ? toDecimal(-p.amount, p.currency) : '', memo: p.memo, tax_code: p.tax_code || undefined, tax_role: p.tax_role || undefined }))
      : [blankLine(), blankLine()],
  );
  const [busy, setBusy] = useState(false);

  // Sensible defaults: the main bank account.
  useEffect(() => {
    if (edit !== undefined) return;
    const bank = app.accounts.find((a) => a.subtype === 'bank');
    if (bank === undefined) return;
    if (from === '' && (kind === 'expense' || kind === 'transfer')) setFrom(bank.id);
    if (to === '' && kind === 'income') setTo(bank.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, app.accounts]);

  const payAcc = app.account(kind === 'income' ? to : from);
  const ccy = payAcc?.currency || app.home;
  const toAcc = app.account(to);
  const crossCcy = kind === 'transfer' && toAcc !== undefined && payAcc !== undefined && (toAcc.currency || app.home) !== (payAcc.currency || app.home);

  const jTotals = useMemo(() => {
    let d = 0;
    let c = 0;
    for (const l of lines) {
      const a = app.account(l.account);
      d += parseMoney(l.debit, a?.currency || app.home) ?? 0;
      c += parseMoney(l.credit, a?.currency || app.home) ?? 0;
    }
    return { d, c };
  }, [lines, app]);

  const save = async (): Promise<void> => {
    const base: EntryInput = { date, narration, reference: reference || undefined, contact: contact || undefined };
    let body: EntryInput;
    if (kind === 'journal' || edit !== undefined) {
      const ps = lines.filter((l) => l.account !== '' && (l.debit !== '' || l.credit !== ''));
      if (ps.length < 2) return void toast.error('A journal entry needs at least two lines');
      body = { ...base, kind: 'journal', postings: ps.map((l) => ({ account: l.account, debit: l.debit || undefined, credit: l.credit || undefined, memo: l.memo || undefined, tax_code: l.tax_code, tax_role: l.tax_role })) };
    } else {
      if (amount === '') return void toast.error('Enter the amount');
      body = { ...base, kind, amount, from: from || undefined, to: to || undefined, category: category || undefined, tax_code: tax || undefined, inclusive, memo: memo || undefined, amount_to: crossCcy ? amountTo : undefined };
    }
    setBusy(true);
    try {
      if (edit !== undefined) {
        const { kind: _k, ...rest } = body;
        void _k;
        await api.updateEntry(edit.id, rest);
        toast.success('Entry saved');
      } else {
        const r = await api.createEntry({ ...body, file: preset?.file });
        toast.success(r.transaction.status === 'proposed' ? 'Entry proposed' : 'Entry recorded');
      }
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setLine = (key: number, patch: Partial<JLine>): void => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const diff = jTotals.d - jTotals.c;

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title={edit !== undefined ? 'Edit entry' : 'New entry'}
      description={edit !== undefined && edit.locked ? 'This entry is in a locked period; it cannot be saved.' : undefined}
      footer={
        <>
          {(kind === 'journal' || edit !== undefined) && (
            <span className={cn('mr-auto num text-[12px] font-semibold', diff === 0 ? 'text-[var(--lf-muted)]' : 'text-[var(--lf-neg-text)]')}>{diff === 0 ? 'Balanced' : 'Off by ' + money(Math.abs(diff), app.home)}</span>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={busy} onClick={() => void save()} disabled={edit?.locked === true}>
            {edit !== undefined ? 'Save' : 'Record'}
          </Btn>
        </>
      }
    >
      <div
        className="flex flex-col gap-3"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
        }}
      >
        {edit === undefined && (
          <div className="h-8 border-b border-[var(--lf-hair)]">
            <Tabs
              value={kind}
              onChange={setKind}
              tabs={[
                { value: 'expense', label: 'Expense' },
                { value: 'income', label: 'Income' },
                { value: 'transfer', label: 'Transfer' },
                { value: 'journal', label: 'Journal' },
              ]}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Date">
            <DateInput value={date} onChange={setDate} />
          </Field>
          {kind !== 'journal' && edit === undefined && (
            <Field label={'Amount' + (ccy ? ' (' + ccy + ')' : '')}>
              <MoneyInput value={amount} onChange={setAmount} autoFocus />
            </Field>
          )}
          {kind !== 'transfer' && (
            <Field label={kind === 'income' ? 'From (payer)' : kind === 'expense' ? 'Paid to' : 'Contact'}>
              <ContactPicker label={kind === 'income' ? 'Payer' : kind === 'expense' ? 'Paid to' : 'Contact'} value={contact} onChange={(v) => setContact(v)} kind={kind === 'income' ? 'customer' : kind === 'expense' ? 'vendor' : undefined} />
            </Field>
          )}
        </div>
        {kind === 'expense' && edit === undefined && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid from">
              <AccountPicker label="Paid from" value={from} onChange={setFrom} filter={isCash} order={['asset', 'liability']} />
            </Field>
            <Field label="Category">
              <AccountPicker label="Category" placeholder="Category" value={category} onChange={setCategory} filter={(a) => isPostable(a) && a.type !== 'income'} />
            </Field>
          </div>
        )}
        {kind === 'income' && edit === undefined && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid into">
              <AccountPicker label="Paid into" value={to} onChange={setTo} filter={isCash} order={['asset', 'liability']} />
            </Field>
            <Field label="Category">
              <AccountPicker label="Category" placeholder="Category" value={category} onChange={setCategory} filter={(a) => isPostable(a) && a.type !== 'expense'} order={['income', 'liability', 'equity', 'asset', 'expense']} />
            </Field>
          </div>
        )}
        {(kind === 'expense' || kind === 'income') && edit === undefined && app.taxCodes.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tax">
              <TaxPicker value={tax} onChange={setTax} scope={kind === 'income' ? 'sales' : 'purchases'} />
            </Field>
            <Field label="Amount includes tax">
              <div className="flex h-7 items-center">
                <Toggle checked={inclusive} onChange={setInclusive} label="Amount includes tax" />
              </div>
            </Field>
          </div>
        )}
        {kind === 'transfer' && edit === undefined && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <AccountPicker label="From account" value={from} onChange={setFrom} filter={(a) => a.type === 'asset' || a.type === 'liability'} order={['asset', 'liability']} />
            </Field>
            <Field label="To">
              <AccountPicker label="To account" value={to} onChange={setTo} filter={(a) => (a.type === 'asset' || a.type === 'liability') && a.id !== from} order={['asset', 'liability']} />
            </Field>
            {crossCcy && (
              <Field label={'Amount received (' + (toAcc?.currency || app.home) + ')'} hint="What arrived in the other currency; it sets the exchange rate.">
                <MoneyInput value={amountTo} onChange={setAmountTo} />
              </Field>
            )}
          </div>
        )}
        {(kind === 'journal' || edit !== undefined) && (
          <div className="overflow-x-auto rounded-[6px] border border-[var(--lf-line)]">
            <table className="lf-table min-w-[560px]">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="r w-[120px]">Debit</th>
                  <th className="r w-[120px]">Credit</th>
                  <th>Memo</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td className="py-1">
                      <AccountPicker value={l.account} onChange={(v) => setLine(l.key, { account: v })} filter={isPostable} small />
                    </td>
                    <td className="py-1">
                      <MoneyInput value={l.debit} onChange={(v) => setLine(l.key, { debit: v, credit: v !== '' ? '' : l.credit })} className="h-6" label="Debit" />
                    </td>
                    <td className="py-1">
                      <MoneyInput value={l.credit} onChange={(v) => setLine(l.key, { credit: v, debit: v !== '' ? '' : l.debit })} className="h-6" label="Credit" />
                    </td>
                    <td className="py-1">
                      <input value={l.memo} onChange={(e) => setLine(l.key, { memo: e.target.value })} className={cn(input, 'h-6')} aria-label="Memo" />
                    </td>
                    <td className="py-1">
                      <IconBtn icon={Trash2} label="Remove line" size={22} onClick={() => setLines((ls) => (ls.length > 2 ? ls.filter((x) => x.key !== l.key) : ls))} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    <Btn variant="ghost" size="xs" icon={Plus} onClick={() => setLines((ls) => [...ls, blankLine()])}>
                      Line
                    </Btn>
                  </td>
                  <td className="r num">{money(jTotals.d, app.home, { symbol: false })}</td>
                  <td className="r num">{money(jTotals.c, app.home, { symbol: false })}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
          <Field label="Description">
            <input value={narration} onChange={(e) => setNarration(e.target.value)} className={input} placeholder={kind === 'journal' ? 'What this entry records' : 'Optional'} />
          </Field>
          <Field label="Reference">
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={input} placeholder="Optional" />
          </Field>
        </div>
        {kind !== 'journal' && edit === undefined && (
          <Field label="Memo">
            <input value={memo} onChange={(e) => setMemo(e.target.value)} className={input} placeholder="Optional" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- import */

const ROLES: { value: string; label: string }[] = [
  { value: '', label: 'Ignore' },
  { value: 'date', label: 'Date' },
  { value: 'amount', label: 'Amount (+/−)' },
  { value: 'debit', label: 'Money out' },
  { value: 'credit', label: 'Money in' },
  { value: 'description', label: 'Description' },
  { value: 'payee', label: 'Payee' },
  { value: 'bank_id', label: 'Reference' },
  { value: 'balance', label: 'Balance' },
];

function roleOf(m: Mapping, i: number): string {
  if (m.date === i) return 'date';
  if (m.amount === i) return 'amount';
  if (m.debit === i) return 'debit';
  if (m.credit === i) return 'credit';
  if (m.payee === i) return 'payee';
  if (m.bank_id === i) return 'bank_id';
  if (m.balance === i) return 'balance';
  if (m.description.includes(i)) return 'description';
  return '';
}

function setRole(m: Mapping, i: number, role: string): Mapping {
  const n: Mapping = { ...m, description: m.description.filter((x) => x !== i) };
  for (const k of ['date', 'amount', 'debit', 'credit', 'payee', 'bank_id', 'balance'] as const) if (n[k] === i) n[k] = -1;
  if (role === 'description') n.description = [...n.description, i].sort((a, b) => a - b);
  else if (role !== '') {
    (n as unknown as Record<string, number>)[role] = i;
    if (role === 'amount') {
      n.debit = -1;
      n.credit = -1;
    }
    if (role === 'debit' || role === 'credit') n.amount = -1;
  }
  return n;
}

function ImportDialog({ account: initialAccount, onClose }: { account?: string | undefined; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const banks = useMemo(() => app.accounts.filter(isCash), [app.accounts]);
  const [account, setAccount] = useState(initialAccount ?? banks[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [paste, setPaste] = useState('');
  const [pasting, setPasting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [order, setOrder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const src = (): { file?: File | undefined; content?: string | undefined; file_name?: string | undefined } => (file !== null ? { file } : { content: paste, file_name: 'pasted.csv' });

  const load = useCallback(
    async (m: Mapping | null, o: string) => {
      if (account === '' || (file === null && paste.trim() === '')) return;
      setBusy(true);
      setError('');
      try {
        const r = await api.preview(account, file !== null ? { file } : { content: paste, file_name: 'pasted.csv' }, { mapping: m, date_order: o || undefined });
        setPreview(r.preview);
        if (r.preview.mapping !== null) setMapping(r.preview.mapping);
      } catch (err) {
        setError(errMessage(err));
        setPreview(null);
      } finally {
        setBusy(false);
      }
    },
    [account, file, paste],
  );

  useEffect(() => {
    if (file !== null) void load(null, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, account]);

  const doImport = async (force = false): Promise<void> => {
    if (preview === null) return;
    setBusy(true);
    try {
      const r = await api.importFile(account, src(), { mapping: preview.format === 'csv' ? mapping : null, date_order: order || undefined, save_profile: preview.format === 'csv', force });
      const parts = [r.new_count + ' new line' + (r.new_count === 1 ? '' : 's')];
      if (r.dup_count > 0) parts.push(r.dup_count + ' already there');
      if (r.auto_posted > 0) parts.push(r.auto_posted + ' booked by rules');
      if (r.agent_waiting > 0) parts.push(r.agent_waiting + ' sent to your AI agent');
      toast.success('Imported: ' + parts.join(', '));
      onClose();
      go('inbox', { account });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const acc = app.account(account);
  const ccy = acc?.currency || app.home;
  return (
    <Modal
      open
      onClose={onClose}
      width="xl"
      title="Import bank statement"
      description="OFX, QFX, QIF, CSV, CAMT.053 or MT940 from your bank. Lines already imported are skipped."
      footer={
        <>
          {preview !== null && preview.already_imported !== null && <span className="mr-auto text-[12px] text-[var(--lf-warn-text)]">This file was imported on {day(preview.already_imported.date)}.</span>}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" icon={ArrowDownToLine} loading={busy} disabled={preview === null || preview.needs_mapping || preview.new_count === 0} onClick={() => void doImport(preview?.already_imported !== null)}>
            {preview === null ? 'Import' : preview.new_count === 0 ? 'Nothing new' : 'Import ' + preview.new_count + ' line' + (preview.new_count === 1 ? '' : 's')}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[260px_1fr]">
          <Field label="Into account">
            <AccountPicker label="Into account" value={account} onChange={setAccount} filter={isCash} order={['asset', 'liability']} />
          </Field>
          <Field label="Statement file" group>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                const f = e.dataTransfer.files[0];
                if (f !== undefined) {
                  setFile(f);
                  setPasting(false);
                }
              }}
              className={cn('flex h-7 items-center gap-2 rounded-[5px] border border-dashed px-2 text-[12.5px]', over ? 'border-[var(--lf-accent)] bg-[var(--lf-accent-soft)]' : 'border-[var(--lf-line)]')}
            >
              <FileText size={14} className="shrink-0 text-[var(--lf-ink-2)]" />
              <span className="min-w-0 flex-1 truncate">{file !== null ? file.name : pasting ? 'Pasted text' : 'Drop a file here'}</span>
              <button type="button" className="shrink-0 font-semibold underline-offset-2 hover:underline" onClick={() => fileRef.current?.click()}>
                Choose
              </button>
              <span className="text-[var(--lf-hair)]">|</span>
              <button
                type="button"
                className="shrink-0 font-semibold underline-offset-2 hover:underline"
                onClick={() => {
                  setPasting(true);
                  setFile(null);
                  setPreview(null);
                }}
              >
                Paste
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".ofx,.qfx,.qif,.csv,.txt,.xml,.sta,.mt940,.940"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f !== undefined) {
                    setFile(f);
                    setPasting(false);
                  }
                  e.target.value = '';
                }}
              />
            </div>
          </Field>
        </div>
        {pasting && file === null && (
          <div className="flex flex-col gap-2">
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} className={cn(area, 'mono')} placeholder={'Date,Description,Amount\n2026-09-02,GITHUB,-21.00'} />
            <div>
              <Btn size="xs" onClick={() => void load(null, '')} disabled={paste.trim() === ''} loading={busy}>
                Read text
              </Btn>
            </div>
          </div>
        )}
        {error !== '' && (
          <p className="flex items-start gap-2 rounded-[5px] bg-[var(--lf-neg-soft)] px-2.5 py-2 text-[12.5px] text-[var(--lf-neg-text)]">
            <AlertTriangle size={14} className="mt-px shrink-0" /> {error}
          </p>
        )}
        {preview !== null && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-[var(--lf-hair)] py-2 text-[12.5px]">
              <span>
                <span className="text-[var(--lf-muted)]">Format </span>
                <b className="uppercase">{preview.format}</b>
              </span>
              {preview.period_from !== '' && (
                <span>
                  <span className="text-[var(--lf-muted)]">Period </span>
                  <b>
                    {day(preview.period_from)} – {day(preview.period_to)}
                  </b>
                </span>
              )}
              <span>
                <span className="text-[var(--lf-muted)]">Lines </span>
                <b className="num">{preview.count}</b>
              </span>
              <span>
                <span className="text-[var(--lf-muted)]">New </span>
                <b className="num">{preview.new_count}</b>
              </span>
              {preview.dup_count > 0 && (
                <span>
                  <span className="text-[var(--lf-muted)]">Already imported </span>
                  <b className="num">{preview.dup_count}</b>
                </span>
              )}
              {preview.balances.closing !== undefined && (
                <span>
                  <span className="text-[var(--lf-muted)]">Closing balance </span>
                  <b className="num">{money(preview.balances.closing, ccy)}</b>
                </span>
              )}
              {preview.profile !== '' && <Chip>Layout: {preview.profile}</Chip>}
            </div>
            {preview.format === 'csv' && mapping !== null && preview.header !== null && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[12px] font-semibold text-[var(--lf-ink-2)]">Columns</span>
                  {preview.needs_mapping && <span className="text-[12px] text-[var(--lf-warn-text)]">Say which column holds the date, the amount (or money in and out) and the description.</span>}
                  <span className="flex-1" />
                  <label className="flex items-center gap-1.5 text-[12px]">
                    <Toggle
                      checked={mapping.flip}
                      onChange={(v) => {
                        const m = { ...mapping, flip: v };
                        setMapping(m);
                        void load(m, order);
                      }}
                      label="Flip signs"
                    />
                    Flip signs (cards)
                  </label>
                  {(preview.date_order_ambiguous || preview.date_order_used !== '') && (
                    <Select
                      small
                      label="Date order"
                      value={order || preview.date_order_used || 'dmy'}
                      onChange={(v) => {
                        setOrder(v);
                        void load(mapping, v);
                      }}
                      options={[
                        { value: 'dmy', label: 'Day/month/year' },
                        { value: 'mdy', label: 'Month/day/year' },
                      ]}
                    />
                  )}
                </div>
                <div className="overflow-x-auto rounded-[6px] border border-[var(--lf-line)]">
                  <table className="lf-table">
                    <thead>
                      <tr>
                        {(mapping.header ? preview.header : preview.header.map((_, i) => 'Column ' + (i + 1))).map((h, i) => (
                          <th key={i} className="normal-case">
                            <div className="flex flex-col gap-1 py-1">
                              <span className="truncate">{h}</span>
                              <Select
                                small
                                label={'Column ' + (i + 1)}
                                value={roleOf(mapping, i)}
                                onChange={(v) => {
                                  const m = setRole(mapping, i, v);
                                  setMapping(m);
                                  void load(m, order);
                                }}
                                options={ROLES}
                              />
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(preview.sample ?? []).slice(mapping.header ? 1 : 0, 5).map((r, i) => (
                        <tr key={i}>
                          {r.map((c, j) => (
                            <td key={j} className="max-w-[180px] truncate text-[12px] text-[var(--lf-ink-2)]">
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {preview.lines.length > 0 && (
              <div className="max-h-[300px] overflow-auto rounded-[6px] border border-[var(--lf-line)]">
                <table className="lf-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="r">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {preview.lines.map((l, i) => (
                      <tr key={i} className={l.duplicate ? 'opacity-45' : ''}>
                        <td className="num">{day(l.date)}</td>
                        <td className="max-w-[360px] truncate">{l.description}</td>
                        <td className="r">
                          <Money value={l.amount} currency={ccy} tone="in" />
                        </td>
                        <td className="w-[90px]">{l.duplicate && <Chip>Already in</Chip>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- upload */

function UploadDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement | null>(null);
  const send = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.upload(files);
      const waiting = r.files.filter((f) => f.agent_state === 'waiting').length;
      toast.success('Added ' + r.files.length + ' file' + (r.files.length === 1 ? '' : 's') + (waiting > 0 ? '; your AI agent will read them' : ''));
      onClose();
      go('inbox', { tab: 'files' });
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
      title="Add receipts and documents"
      description="Receipts, supplier invoices and PDF statements. Your AI agent reads them, attaches each to its entry or drafts the bill."
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" icon={Upload} loading={busy} disabled={files.length === 0} onClick={() => void send()}>
            Add {files.length > 0 ? files.length : ''}
          </Btn>
        </>
      }
    >
      <button
        type="button"
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          setFiles((fs) => [...fs, ...Array.from(e.dataTransfer.files)]);
        }}
        className={cn('flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-[6px] border border-dashed text-[12.5px]', over ? 'border-[var(--lf-accent)] bg-[var(--lf-accent-soft)]' : 'border-[var(--lf-line)] hover:bg-[var(--lf-row)]')}
      >
        <Upload size={18} className="text-[var(--lf-ink-2)]" />
        <span className="font-semibold">Drop files or choose</span>
        <span className="text-[var(--lf-muted)]">PDF, images, up to 25 MB each</span>
      </button>
      <input
        ref={ref}
        type="file"
        multiple
        accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.gif,.txt,.eml"
        className="hidden"
        onChange={(e) => {
          setFiles((fs) => [...fs, ...Array.from(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      {files.length > 0 && (
        <ul className="mt-2 flex flex-col">
          {files.map((f, i) => (
            <li key={i} className="flex h-8 items-center gap-2 border-b border-[var(--lf-hair)] text-[12.5px]">
              <FileText size={14} className="shrink-0 text-[var(--lf-ink-2)]" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <IconBtn icon={Trash2} label="Remove" size={22} onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

